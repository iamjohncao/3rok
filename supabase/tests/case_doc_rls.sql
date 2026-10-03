-- Row-level security test for public.case_doc.
--
-- Creates two throwaway users, then tries every cross-account action as each of
-- them and as the signed-out `anon` role. Any wrong outcome raises an exception
-- that names it. It runs in one transaction and ends in ROLLBACK, so it leaves no
-- users and no rows behind. Run it in the Supabase SQL editor, or with
-- `supabase db query --file supabase/tests/case_doc_rls.sql`.

begin;

do $test$
declare
  alice     uuid := gen_random_uuid();
  bob       uuid := gen_random_uuid();
  alice_case uuid := gen_random_uuid();
  seen      int;
  touched   int;
  failed    boolean;
  state     text;
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
     confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    (alice, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'alice-' || alice || '@rls.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    (bob, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'bob-' || bob || '@rls.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  ---------------------------------------------------------------- as Alice
  perform set_config('request.jwt.claims', json_build_object('sub', alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.case_doc (id, account_id, document)
  values (alice_case, alice, jsonb_build_object('id', alice_case, 'accountId', alice, 'name', 'Alice case'));

  select count(*) into seen from public.case_doc;
  if seen <> 1 then raise exception 'FAIL: Alice should see her 1 case, saw %', seen; end if;

  -- She cannot write a row owned by Bob.
  failed := false;
  begin
    insert into public.case_doc (id, account_id, document)
    values (gen_random_uuid(), bob, '{}'::jsonb);
  exception when others then failed := true; get stacked diagnostics state = returned_sqlstate;
  end;
  if not failed then raise exception 'FAIL: Alice inserted a row owned by Bob'; end if;

  -- The document must name the row's owner, and the row's id.
  failed := false;
  begin
    insert into public.case_doc (id, account_id, document)
    values (gen_random_uuid(), alice, jsonb_build_object('accountId', bob));
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'FAIL: a document naming another owner was saved'; end if;

  failed := false;
  begin
    insert into public.case_doc (id, account_id, document)
    values (gen_random_uuid(), alice, '{"name":"no owner"}'::jsonb);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'FAIL: a document with no accountId was saved'; end if;

  failed := false;
  begin
    insert into public.case_doc (id, account_id, document)
    values (gen_random_uuid(), alice, jsonb_build_object('id', gen_random_uuid(), 'accountId', alice));
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'FAIL: a document whose id differs from the row id was saved'; end if;

  -- She cannot hand her case to Bob.
  failed := false;
  begin
    update public.case_doc set account_id = bob where id = alice_case;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: Alice reassigned her case to Bob'; end if;

  -- She can edit her own case.
  update public.case_doc
     set document = document || jsonb_build_object('name', 'Renamed by Alice')
   where id = alice_case;
  get diagnostics touched = row_count;
  if touched <> 1 then raise exception 'FAIL: Alice could not update her own case'; end if;

  ---------------------------------------------------------------- as Bob
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into seen from public.case_doc;
  if seen <> 0 then raise exception 'FAIL: Bob can see % of Alice''s rows', seen; end if;

  select count(*) into seen from public.case_doc where id = alice_case;
  if seen <> 0 then raise exception 'FAIL: Bob can read Alice''s case by id'; end if;

  update public.case_doc set document = '{}'::jsonb where id = alice_case;
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'FAIL: Bob updated Alice''s case'; end if;

  delete from public.case_doc where id = alice_case;
  get diagnostics touched = row_count;
  if touched <> 0 then raise exception 'FAIL: Bob deleted Alice''s case'; end if;

  -- An upsert on Alice's id, which is how the app saves, must not take it over.
  failed := false;
  begin
    insert into public.case_doc (id, account_id, document)
    values (alice_case, bob, jsonb_build_object('id', alice_case, 'accountId', bob, 'name', 'Taken by Bob'))
    on conflict (id) do update set document = excluded.document, account_id = excluded.account_id;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: Bob took over Alice''s case with an upsert'; end if;

  ---------------------------------------------------------------- signed out
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';

  failed := false;
  begin
    perform count(*) from public.case_doc;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL: the anon role can read case_doc'; end if;

  ---------------------------------------------------------------- Alice's case is untouched
  execute 'reset role';
  select count(*) into seen
    from public.case_doc
   where id = alice_case and account_id = alice and document ->> 'name' = 'Renamed by Alice';
  if seen <> 1 then raise exception 'FAIL: Alice''s case changed when it should not have'; end if;

  raise notice 'PASS: case_doc row-level security holds for every cross-account action tried';
end
$test$;

rollback;
