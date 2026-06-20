# pdforum — Implementation Plan (Phase 1)

Working style: **brainstorm → spec → plan → execute with TDD and frequent
commits**, verifying in a real browser before claiming anything is done. Each
task below is a small, committable unit. Tests come before/with implementation
for the logic that has interesting behavior (threading, parsing, RLS).

Legend: ☐ todo · ☑ done

## Milestone 0 — Repo scaffolding & docs
- ☑ Confirm repo structure and the Gmail-auth decision.
- ☑ Write `docs/spec.md`.
- ☑ Write `docs/plan.md`.
- ☐ `README.md`: what it is, the single-sender caveat, setup outline.
- ☐ `.gitignore`, license/owner note as needed.
- ☐ Commit + push, open draft PR.

## Milestone 1 — Database schema (TDD via SQL assertions)
- ☐ `supabase/migrations/0001_init.sql`: tables from spec §6
  (`members`, `list_subscriptions`, `messages`, `threads`, `sync_state`),
  with Phase-2 columns present but unused (`direction`, `author_member_id`,
  `delivery_status`).
- ☐ Indexes from spec §6.
- ☐ `supabase/migrations/0002_rls.sql`: enable RLS on all tables; member-only
  read policies; no anon access; service-role writes.
- ☐ Tests: SQL/pgTAP-style or a Deno test hitting a local Supabase that asserts
  (a) anon cannot read, (b) member can read own list, (c) unique constraint on
  `rfc_message_id` holds.
- ☐ Commit per migration.

## Milestone 2 — Threading & parsing logic (pure, heavily unit-tested)
This is the core. No Gmail, no DB — pure functions in `_shared/`.
- ☐ `_shared/headers.ts`: normalize Message-ID, parse `References`/`In-Reply-To`,
  normalize subjects (strip Re:/Fwd:). **Tests first.**
- ☐ `_shared/mime.ts`: parse a raw RFC822 message → `ParsedMessage`
  (from/to/subject/date/body_text/body_html/headers). **Tests first**, with
  fixture emails (plain, multipart/alternative, with/without References).
- ☐ `_shared/threading.ts`: `assignThread()` + thread reconciliation incl.
  out-of-order/late-root re-parenting. **Tests first**, covering:
  - reply via In-Reply-To,
  - reply via References when In-Reply-To missing,
  - root with no ancestors,
  - out-of-order arrival (child before parent) → re-parent,
  - conservative subject fallback off by default.
- ☐ Commit per module (tests + impl together).

## Milestone 3 — poll-gmail Edge Function (integration)
- ☐ `_shared/gmail.ts`: OAuth2 refresh-token → access-token exchange; thin Gmail
  REST client (`messages.list`, `messages.get`, `history.list`). Unit-test the
  token/url building with mocked `fetch`.
- ☐ `functions/poll-gmail/index.ts`: orchestrate — read `sync_state`, fetch new
  messages (full vs incremental), parse (Milestone 2), upsert messages, assign
  threads, advance cursor. Idempotent on `rfc_message_id`.
- ☐ Tests with mocked Gmail responses + a local Supabase (or mocked repo layer):
  ingest a fixture conversation end-to-end → assert thread structure in DB.
- ☐ Document required secrets (`GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN`) and the
  one-time OAuth refresh-token generation steps in README.
- ☐ Schedule via `pg_cron` / Supabase scheduled function (migration or config).
- ☐ Commit incrementally.

## Milestone 4 — Read-only web UI (verify in real browser)
- ☐ Scaffold `web/` (Vite + TypeScript + `@supabase/supabase-js`).
- ☐ Auth: invite-only sign-in screen; gate all views behind a session.
- ☐ Thread list view (ordered by `last_message_at desc`).
- ☐ Thread detail view (tree/indented rendering, sanitized body).
- ☐ Read-only banner explaining it's a mirror.
- ☐ Config via build-time env (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- ☐ **Verify in a real browser**: sign in as a seeded member, see seeded
  threads, confirm anon is denied. Only then mark done.
- ☐ Commit incrementally.

## Milestone 5 — Deploy
- ☐ `.github/workflows/deploy.yml`: build `web/` → deploy to GitHub Pages.
- ☐ Inject `VITE_*` from GitHub Actions secrets.
- ☐ Verify the deployed site loads and auth works against Supabase.
- ☐ Commit.

## Cross-cutting
- Frequent commits, one logical change each; descriptive messages.
- Keep PR a draft until Phase 1 is browser-verified.
- Never commit secrets. Never add list-sending code in Phase 1.

## Open items to confirm as we go
- Auth method for members: magic link vs password (default: magic link).
- `web/` exact rendering of thread tree (indented tree vs flattened) — decide
  when building Milestone 4.
- Whether to backfill existing inbox mail on first run or only mirror new mail
  (default: bounded backfill of what's in the inbox).
