-- Phase 3: saved cases. One case document per row, owned by one Supabase Auth user.
--
-- Supabase Auth owns users, credentials, and sessions. There is no account table
-- and no password column here. A person reads and writes only their own rows:
-- the app's routes check the signed-in user, and row-level security checks it
-- again in the database, so a bug in a route cannot leak another person's case.

create table public.case_doc (
  id          uuid primary key,
  account_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  document    jsonb not null,
  updated_at  timestamptz not null default now(),

  -- The document names its owner and its id. They must match the row. IS NOT
  -- DISTINCT FROM, because a plain = passes when the document has no accountId.
  constraint case_doc_document_is_an_object
    check (jsonb_typeof(document) = 'object'),
  constraint case_doc_document_owner_matches_row
    check ((document ->> 'accountId') is not distinct from account_id::text),
  constraint case_doc_document_id_matches_row
    check ((document ->> 'id') is not distinct from id::text)
);

comment on table public.case_doc is
  'One 3rok case document (lib/case.ts CaseDocument) per row. The flight is only the two OEM strings inside the document.';

create index case_doc_account_updated_idx
  on public.case_doc (account_id, updated_at desc);

alter table public.case_doc enable row level security;

-- Signed-out visitors (the anon role) have no access at all.
revoke all on public.case_doc from anon;
grant select, insert, update, delete on public.case_doc to authenticated;

-- (select auth.uid()) is evaluated once per statement, not once per row.
create policy case_doc_select_own on public.case_doc
  for select to authenticated
  using (account_id = (select auth.uid()));

create policy case_doc_insert_own on public.case_doc
  for insert to authenticated
  with check (account_id = (select auth.uid()));

create policy case_doc_update_own on public.case_doc
  for update to authenticated
  using (account_id = (select auth.uid()))
  with check (account_id = (select auth.uid()));

create policy case_doc_delete_own on public.case_doc
  for delete to authenticated
  using (account_id = (select auth.uid()));
