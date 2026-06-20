# pdforum — Specification

## 1. What it is

`pdforum` is a **read-only, threaded web forum that mirrors a private email
list**. The list has no public archive and only one Gmail account is subscribed
to it. pdforum makes that list readable on the web for a small, known group of
people, without changing how the list itself operates.

The project owner is *only a subscriber* to the list. pdforum must therefore be
**unobtrusive**: in Phase 1 it never sends anything to the list and never
changes list behavior. It only reads the one subscribed inbox and republishes
the content to an invite-only website.

## 2. Goals & non-goals

### Phase 1 (this phase) — Read-only mirror
- Poll the single subscribed Gmail inbox on a schedule.
- Parse each list email into a normalized message record.
- Reconstruct conversation threads from email headers.
- Store everything in Supabase Postgres.
- Serve a threaded, read-only forum UI to an invite-only audience.
- Stay completely passive toward the upstream list (no sends, no list writes).

### Phase 2 (designed-for, not built) — Reply-back
- Allow forum members to post replies that get delivered to the list.
- **Hard caveat:** because only ONE Gmail account is subscribed and there is no
  archive, every reply from the forum would leave the list *from that single
  address*. To the list and its moderators, all forum activity would appear to
  come from one person, which can trip moderation / anti-spam / "you're posting
  too much" rules.
- Phase 2 is therefore deferred. The **schema** is designed to accommodate it
  now (see §6), but no sending code is written in Phase 1.

### Non-goals
- No public/anonymous access. Ever (the list is private).
- No editing or moderation of list content from the web.
- No mobile apps; a responsive static web UI is sufficient.
- No full-text search engine in Phase 1 (Postgres `tsvector` may come later).

## 3. Constraints & caveats that shape the design

1. **Single ingress/egress point.** The only connection to the list is one
   Gmail mailbox. All ingestion flows through it; any future egress would too.
2. **No archive.** We cannot backfill history beyond what is in that mailbox.
   The mirror's history effectively starts when polling starts (plus whatever
   old mail remains in the inbox).
3. **Privacy.** Content is private to a known group → invite-only auth, no
   public archive, Row Level Security on every table.
4. **Unobtrusiveness.** Polling must be gentle (incremental sync via Gmail
   History API) and must never mark-as-read, delete, label, or otherwise mutate
   the mailbox in a way the list owner would notice. Read-only Gmail scope.

## 4. Architecture

```
        ┌──────────────┐   cron (pg_cron / scheduled)   ┌────────────────────┐
        │ Gmail inbox  │ ◀───────── poll ─────────────── │ Supabase Edge Fn   │
        │ (subscribed) │  Gmail REST API (read-only)     │   poll-gmail       │
        └──────────────┘ ──────── messages ────────────▶ │  parse + thread    │
                                                          └─────────┬──────────┘
                                                                    │ upsert
                                                                    ▼
                                                          ┌────────────────────┐
                                                          │ Supabase Postgres  │
                                                          │ messages / threads │
                                                          └─────────┬──────────┘
                                                                    │ PostgREST + RLS
                                                                    ▼
                                                          ┌────────────────────┐
                                                          │ Static web UI      │
                                                          │ (GitHub Pages)     │
                                                          │ Supabase Auth      │
                                                          └────────────────────┘
```

- **Ingestion:** `supabase/functions/poll-gmail` — a Deno Edge Function invoked
  on a cron. It authenticates to Gmail via OAuth2 (refresh token), fetches new
  messages incrementally, parses them, computes threading, and upserts into
  Postgres using the service role.
- **Storage:** Supabase Postgres. RLS restricts reads to authenticated members.
- **Frontend:** Static SPA (Vite + TypeScript) hosted on GitHub Pages, talking
  to Supabase via `@supabase/supabase-js` with the anon key. All data access is
  mediated by RLS.
- **Auth:** Supabase Auth, invite-only. Only provisioned members can sign in.

## 5. Gmail ingestion

### Authentication (decided)
- **Gmail REST API with OAuth2 refresh token.** Chosen over IMAP because Edge
  Functions are HTTP/short-lived on Deno; the REST API works over `fetch()` and
  the History API enables cheap incremental polling. IMAP would need a
  long-lived TCP socket and lacks solid Deno tooling.
- **Scope:** `https://www.googleapis.com/auth/gmail.readonly` — read-only, so we
  can never mutate the mailbox.
- **Secrets:** stored in **Supabase function secrets** (`supabase secrets set`),
  injected as env vars. Never committed.
  - `GMAIL_CLIENT_ID`
  - `GMAIL_CLIENT_SECRET`
  - `GMAIL_REFRESH_TOKEN`
- At invocation the function exchanges the refresh token for a short-lived
  access token, then calls the Gmail API.

### Polling strategy
- **First run (no stored historyId):** list messages in the mailbox (optionally
  bounded by a `q` query / date), fetch each in `format=raw` or `format=full`,
  parse, store, and record the latest `historyId`.
- **Subsequent runs:** call `users.history.list?startHistoryId=<stored>` to get
  only new message IDs since last poll, fetch + parse + store those, advance the
  stored `historyId`. This is the gentle, incremental path.
- Store the cursor in a `sync_state` table (single row).
- Idempotency: upsert keyed on RFC `Message-ID`; re-ingesting the same message
  is a no-op.

### Parsing
From each message we extract:
- `rfc_message_id` (the `Message-ID` header, normalized: angle brackets
  stripped, trimmed).
- `in_reply_to` (the `In-Reply-To` header, normalized).
- `references` (the `References` header → ordered list of message-ids).
- `from` (display name + email), `to`, `subject`, `date`.
- `body_text` and `body_html` (prefer parsing both MIME parts).
- `gmail_id` / `gmail_thread_id` (Gmail's own ids, kept for debugging/sync).

## 6. Data model

> The schema is designed so Phase 2 (reply-back) slots in without migration
> churn. Phase 1 simply never writes the "outgoing" rows.

### `members`
Known people allowed to use the forum. Linked to Supabase Auth users.
- `id` (uuid, pk) — matches `auth.users.id`.
- `email` (text, unique).
- `display_name` (text).
- `role` (text: `member` | `admin`).
- `created_at`.

### `list_subscriptions`
Describes the upstream mailing list(s) being mirrored. (One row in practice now,
but modeled as a table to keep the source explicit and Phase-2-ready.)
- `id` (uuid, pk).
- `list_name` (text).
- `list_address` (text) — the list's posting address, if known.
- `gmail_account` (text) — the subscribed mailbox address.
- `created_at`.

### `messages`
One row per email. The heart of the mirror.
- `id` (uuid, pk).
- `subscription_id` (fk → list_subscriptions).
- `rfc_message_id` (text, unique, not null) — RFC Message-ID, normalized.
- `in_reply_to` (text, null) — normalized parent Message-ID.
- `references` (text[], default `{}`) — normalized ancestor Message-IDs.
- `thread_id` (fk → threads).
- `from_name` (text), `from_email` (text).
- `to_raw` (text) — raw To/Cc for display.
- `subject` (text).
- `body_text` (text), `body_html` (text).
- `sent_at` (timestamptz) — the email Date header.
- `gmail_id` (text), `gmail_thread_id` (text).
- `created_at` (timestamptz, default now).
- **Direction marker for Phase 2:** `direction` (text, default `inbound`;
  future values `outbound`). Lets the same table hold forum-originated replies
  later.
- **Phase 2 placeholders (nullable now):** `author_member_id` (fk → members,
  null for inbound list mail), `delivery_status` (text, null).

### `threads`
A conversation. Derived from message headers.
- `id` (uuid, pk).
- `subscription_id` (fk → list_subscriptions).
- `root_message_id` (fk → messages, null until known).
- `subject` (text) — normalized subject of the root (strip `Re:` etc.).
- `last_message_at` (timestamptz) — for ordering the thread list.
- `message_count` (int).
- `created_at`.

### `sync_state`
Cursor for incremental Gmail polling.
- `id` (int, pk, single row).
- `subscription_id` (fk → list_subscriptions).
- `gmail_history_id` (text).
- `last_polled_at` (timestamptz).

### Indexes
- `messages(rfc_message_id)` unique.
- `messages(thread_id, sent_at)`.
- `messages(in_reply_to)`.
- `threads(subscription_id, last_message_at desc)`.

## 7. Threading algorithm

Goal: group messages into conversations and order them, using only email
headers (JWZ-style, simplified). This is the **core unit-tested logic** and
lives in `supabase/functions/_shared/threading.ts`, pure and side-effect-free.

Rules, in order of preference:
1. **Parent by `In-Reply-To`.** If a message's `in_reply_to` matches a known
   `rfc_message_id`, it is a child of that message and joins its thread.
2. **Parent by `References`.** Else, walk `references` from the *last* entry
   backward; the first one matching a known message determines the thread.
3. **No known ancestor.** The message starts (or is) a thread root.
4. **Subject fallback (conservative).** Optionally, if no header linkage exists,
   group by normalized subject *and* close-in-time heuristics. Kept off by
   default / behind a flag to avoid over-merging — header-based threading is
   authoritative.
5. **Late-arriving roots.** Because mail can arrive out of order, threading must
   be able to *re-parent*: when a referenced ancestor shows up later, children
   already stored under a placeholder thread are merged. Implementation: resolve
   threads by walking references each ingest and reconciling thread ids.

Pure function signature (illustrative):
```ts
// Given the new message + an index of already-known messages,
// return the thread assignment (existing thread id or "new") and parent id.
function assignThread(
  msg: ParsedMessage,
  known: Map<MessageId, KnownMessage>
): ThreadAssignment
```

Subject normalization: strip leading `Re:`, `Fwd:`, `Fw:` (case-insensitive,
repeated), collapse whitespace. Used for thread titles and the conservative
subject fallback.

## 8. Web UI (read-only)

- **Sign in** via Supabase Auth (invite-only; magic link or password — settle in
  plan). Non-members cannot read anything (RLS denies).
- **Thread list:** subscriptions → threads ordered by `last_message_at desc`,
  showing subject, participant count, message count, last activity.
- **Thread view:** messages in a thread rendered as an indented tree (or
  flattened chronological with reply-depth indicators), sanitized HTML or text.
- **Read-only:** no compose box in Phase 1. A visible note explains it's a
  mirror and (eventually) the single-sender caveat.
- **Hosting:** built to static assets, deployed to GitHub Pages via Actions.

## 9. Security & privacy

- **RLS on every table.** Reads allowed only to authenticated members
  (`auth.uid()` present in `members`). No anonymous read.
- The Edge Function uses the **service role** key (server-side only) to write;
  the browser only ever uses the **anon** key under RLS.
- Gmail scope is **read-only**; no path exists in Phase 1 to mutate the mailbox
  or the list.
- Secrets only in Supabase function secrets / GitHub Actions secrets — never in
  the repo.

## 10. Phase 2 design notes (not built now)

- Reply-back would add `direction='outbound'` rows authored by a `member`,
  queued with a `delivery_status`, and a *separate* send function using a
  Gmail **send** scope.
- The single-sender caveat must be surfaced to users and likely rate-limited /
  batched, and may require list-owner coordination. Explicitly out of scope for
  Phase 1.
