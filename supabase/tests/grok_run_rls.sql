-- Row-level security test for public.grok_run. Two throwaway users, every cross-account action,
-- and the signed-out role. Runs in one transaction and ends in ROLLBACK, so it leaves nothing.

begin;

do $test$
declare
  alice uuid := gen_random_uuid();
  bob   uuid := gen_random_uuid();
  seen  int;
  touched int;
  failed boolean;
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

  insert into public.grok_run (case_id) values (gen_random_uuid());
  insert into public.grok_run (account_id, case_id) values (alice, gen_random_uuid());

  select count(*) into seen from public.grok_run;
  if seen <> 2 then raise exception 'FAIL: Alice should see her 2 runs, saw %', seen; end if;

  -- Alice cannot write a row for Bob.
  failed := false;
  begin
    insert into public.grok_run (account_id, case_id) values (bob, gen_random_uuid());
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: Alice inserted a run for Bob'; end if;

  -- Alice cannot change or delete her own rows, so she cannot reset her count.
  failed := false;
  begin
    update public.grok_run set started_at = now() - interval '2 hours';
    get diagnostics touched = row_count;
  exception when others then failed := true;
  end;
  if not failed and touched > 0 then raise exception 'FAIL: Alice changed % runs', touched; end if;

  failed := false;
  begin
    delete from public.grok_run;
    get diagnostics touched = row_count;
  exception when others then failed := true;
  end;
  if not failed and touched > 0 then raise exception 'FAIL: Alice deleted % runs', touched; end if;

  ---------------------------------------------------------------- as Bob
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into seen from public.grok_run;
  if seen <> 0 then raise exception 'FAIL: Bob should see none of Alice''s runs, saw %', seen; end if;

  ---------------------------------------------------------------- signed out
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';

  failed := false;
  begin
    perform count(*) from public.grok_run;
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: the signed-out role could read grok_run'; end if;

  raise notice 'grok_run row-level security: all checks passed';
end
$test$;

rollback;
