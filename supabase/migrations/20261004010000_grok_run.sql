-- Phase 7: a ledger of Ask Grok runs, so one signed-in account cannot spend the deployment's xAI
-- credits without limit. Sign-up is open, so the limit is per account and enforced by the route
-- before it calls xAI. A person reads and writes only their own rows, and cannot change or delete
-- one, so the count in the last hour cannot be reset from the browser.

create table public.grok_run (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  case_id     uuid not null,
  started_at  timestamptz not null default now()
);

comment on table public.grok_run is
  'One row per Ask Grok request an account started. Counted per hour by app/api/grok/route.ts. Not part of the case contract.';

create index grok_run_account_started_idx
  on public.grok_run (account_id, started_at desc);

alter table public.grok_run enable row level security;

-- Signed-out visitors (the anon role) have no access at all. Supabase grants every privilege on a new
-- table to its API roles by default, so take them all back and give only select and insert. No update
-- or delete is granted, so a person cannot reset their count.
revoke all on public.grok_run from anon;
revoke all on public.grok_run from authenticated;
grant select, insert on public.grok_run to authenticated;

create policy grok_run_select_own on public.grok_run
  for select to authenticated
  using (account_id = (select auth.uid()));

create policy grok_run_insert_own on public.grok_run
  for insert to authenticated
  with check (account_id = (select auth.uid()));
