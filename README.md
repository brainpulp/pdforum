# pdforum

A **read-only, threaded web forum that mirrors a private email list** so the
list can be read on the web by a small, known group.

The list has no public archive and only **one** Gmail account is subscribed to
it. pdforum reads that single inbox, reconstructs conversation threads from
email headers, stores them in Supabase, and serves them as an invite-only,
read-only forum. It does **not** change how the list works.

## ⚠️ The single-sender caveat (why this is read-only for now)

Only one Gmail account is subscribed to the list, and the list has no archive.
That means **any reply sent from the forum would go to the list from that one
address** — so to the list and its moderators, *all* forum activity would look
like it comes from a single person. That can trip list moderation and
anti-spam rules.

For that reason **Phase 1 is strictly read-only**: pdforum never sends to the
list and never mutates the mailbox (Gmail access is read-only scope). Reply-back
("Phase 2") is *designed for* in the schema but deliberately **not built yet**.
See [`docs/spec.md`](docs/spec.md).

## How it works

```
Gmail inbox  ──poll (Gmail REST, read-only)──▶  Supabase Edge Fn (poll-gmail)
                                                    │  parse + thread
                                                    ▼
                                                Supabase Postgres
                                                    │  PostgREST + RLS
                                                    ▼
                                                Static web UI (GitHub Pages)
                                                    Supabase Auth (invite-only)
```

- **Ingestion:** `supabase/functions/poll-gmail` runs on a cron, fetches new
  mail via the Gmail REST API (incremental via the History API), parses it, and
  threads it using `Message-ID` / `In-Reply-To` / `References`.
- **Storage:** Supabase Postgres, Row Level Security on every table.
- **Frontend:** static Vite + TypeScript SPA on GitHub Pages, talking to
  Supabase with the anon key under RLS.
- **Auth:** Supabase Auth, invite-only — only provisioned members can read.

## Repo layout

```
pdforum/
├─ README.md
├─ docs/
│  ├─ spec.md          # Phase 1 + Phase 2 vision
│  └─ plan.md          # TDD task breakdown
├─ supabase/
│  ├─ migrations/      # schema + RLS
│  └─ functions/
│     ├─ _shared/      # pure, unit-tested logic (headers, mime, threading, gmail)
│     └─ poll-gmail/   # Edge Function: Gmail → DB
├─ web/                # read-only forum UI → GitHub Pages
└─ .github/workflows/  # build web → Pages
```

## Setup (outline — filled in as the build progresses)

### Gmail auth (one-time)
poll-gmail authenticates with the **Gmail REST API using an OAuth2 refresh
token** (read-only scope `gmail.readonly`). You will:
1. Create a Google Cloud project, enable the Gmail API, configure an OAuth
   consent screen, and create OAuth client credentials.
2. Generate a **refresh token** for the subscribed Gmail account
   (scope `https://www.googleapis.com/auth/gmail.readonly`).
3. Store the secrets in **Supabase function secrets**:
   ```
   supabase secrets set GMAIL_CLIENT_ID=...
   supabase secrets set GMAIL_CLIENT_SECRET=...
   supabase secrets set GMAIL_REFRESH_TOKEN=...
   ```
Secrets are **never** committed to this repo.

### Database
Apply the migrations in `supabase/migrations/` to your Supabase project.

### Web
`web/` builds to static assets and is deployed to GitHub Pages by the workflow
in `.github/workflows/`. Configure `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` as build-time env / GitHub Actions secrets.

## Status

Phase 1 (read-only mirror) is under active development. See
[`docs/plan.md`](docs/plan.md) for the task breakdown and current progress.
