-- Supabase grants every privilege on a new table to its API roles by default. case_doc needs
-- select, insert, update and delete for signed-in people, under the row-level policies, and
-- nothing else. Truncate is not covered by row-level security, so it is taken back, with the
-- references and trigger privileges the app never uses.

revoke truncate, references, trigger on public.case_doc from authenticated;
