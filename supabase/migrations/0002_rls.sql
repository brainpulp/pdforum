-- pdforum — Row Level Security (Phase 1: read-only mirror)
--
-- Privacy model (docs/spec.md §9):
--   * The list is private → NO anonymous access to any table.
--   * Authenticated MEMBERS may READ mirrored content.
--   * Only the service role (used by the poll-gmail Edge Function) may WRITE.
--
-- With RLS enabled and no permissive policy for a given action, that action is
-- denied for anon/authenticated roles. The service role bypasses RLS entirely,
-- so writes from poll-gmail are unaffected. We therefore add only SELECT
-- policies for members; the absence of INSERT/UPDATE/DELETE policies denies
-- those to clients.

-- Helper: is the current auth user a provisioned member?
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members m where m.id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
alter table public.members            enable row level security;
alter table public.list_subscriptions enable row level security;
alter table public.threads            enable row level security;
alter table public.messages           enable row level security;
alter table public.sync_state         enable row level security;

-- ---------------------------------------------------------------------------
-- members: a member may read their own row and other members' rows
-- (needed to render author/display names). No client writes.
-- ---------------------------------------------------------------------------
create policy members_select_for_members
  on public.members for select
  to authenticated
  using (public.is_member());

-- ---------------------------------------------------------------------------
-- list_subscriptions: members may read which lists are mirrored
-- ---------------------------------------------------------------------------
create policy subscriptions_select_for_members
  on public.list_subscriptions for select
  to authenticated
  using (public.is_member());

-- ---------------------------------------------------------------------------
-- threads: members may read all threads
-- ---------------------------------------------------------------------------
create policy threads_select_for_members
  on public.threads for select
  to authenticated
  using (public.is_member());

-- ---------------------------------------------------------------------------
-- messages: members may read all mirrored messages
-- ---------------------------------------------------------------------------
create policy messages_select_for_members
  on public.messages for select
  to authenticated
  using (public.is_member());

-- ---------------------------------------------------------------------------
-- sync_state: internal only. No client policies → no anon/authenticated access.
-- (Service role bypasses RLS and manages this row.)
-- ---------------------------------------------------------------------------
