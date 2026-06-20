-- pdforum — initial schema (Phase 1: read-only mirror)
--
-- Designed so Phase 2 (reply-back) slots in without migration churn:
-- the "outbound"/authored columns exist now but stay unused in Phase 1.
-- See docs/spec.md §6.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- members: known people allowed to use the forum (linked to Supabase Auth)
-- ---------------------------------------------------------------------------
create table if not exists public.members (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null unique,
  display_name text,
  role         text not null default 'member'
                 check (role in ('member', 'admin')),
  created_at   timestamptz not null default now()
);

comment on table public.members is
  'Invite-only forum members. id matches auth.users.id.';

-- ---------------------------------------------------------------------------
-- list_subscriptions: the upstream mailing list(s) being mirrored
-- ---------------------------------------------------------------------------
create table if not exists public.list_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  list_name     text not null,
  list_address  text,                 -- the list's posting address, if known
  gmail_account text not null,         -- the single subscribed mailbox
  created_at    timestamptz not null default now()
);

comment on table public.list_subscriptions is
  'Upstream mailing lists mirrored by pdforum. One row in practice.';

-- ---------------------------------------------------------------------------
-- threads: a conversation, derived from message headers
-- ---------------------------------------------------------------------------
create table if not exists public.threads (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.list_subscriptions (id) on delete cascade,
  root_message_id uuid,               -- fk added after messages exists (deferred)
  subject         text,               -- normalized subject of the root
  last_message_at timestamptz,        -- for ordering the thread list
  message_count   integer not null default 0,
  created_at      timestamptz not null default now()
);

comment on table public.threads is
  'Conversations reconstructed from email Message-ID/In-Reply-To/References.';

-- ---------------------------------------------------------------------------
-- messages: one row per email — the heart of the mirror
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.list_subscriptions (id) on delete cascade,

  -- RFC threading headers (normalized: angle brackets stripped, trimmed)
  rfc_message_id  text not null unique,
  in_reply_to     text,
  "references"    text[] not null default '{}',

  thread_id       uuid references public.threads (id) on delete set null,

  -- envelope / display
  from_name       text,
  from_email      text,
  to_raw          text,
  subject         text,
  body_text       text,
  body_html       text,
  sent_at         timestamptz,

  -- Gmail bookkeeping (for sync/debug)
  gmail_id        text,
  gmail_thread_id text,

  created_at      timestamptz not null default now(),

  -- Phase 2 placeholders (unused in Phase 1) -------------------------------
  direction        text not null default 'inbound'
                     check (direction in ('inbound', 'outbound')),
  author_member_id uuid references public.members (id) on delete set null,
  delivery_status  text
);

comment on table public.messages is
  'One row per mirrored email. direction/author_member_id/delivery_status '
  'are Phase 2 (reply-back) placeholders, unused in Phase 1.';

-- threads.root_message_id -> messages.id (deferred fk, now that messages exists)
alter table public.threads
  add constraint threads_root_message_id_fkey
  foreign key (root_message_id) references public.messages (id) on delete set null;

-- ---------------------------------------------------------------------------
-- sync_state: cursor for incremental Gmail polling
-- ---------------------------------------------------------------------------
create table if not exists public.sync_state (
  id               integer primary key default 1 check (id = 1),
  subscription_id  uuid references public.list_subscriptions (id) on delete cascade,
  gmail_history_id text,
  last_polled_at   timestamptz
);

comment on table public.sync_state is
  'Single-row incremental-sync cursor (Gmail historyId) for poll-gmail.';

-- ---------------------------------------------------------------------------
-- Indexes (spec §6)
-- ---------------------------------------------------------------------------
create index if not exists messages_thread_sent_idx
  on public.messages (thread_id, sent_at);
create index if not exists messages_in_reply_to_idx
  on public.messages (in_reply_to);
create index if not exists threads_subscription_last_idx
  on public.threads (subscription_id, last_message_at desc);
