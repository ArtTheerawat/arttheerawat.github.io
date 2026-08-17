-- ============================================================================
-- Theedeck hidden-tasks — move from PER-USER to GLOBAL.
-- ----------------------------------------------------------------------------
-- Supabase Dashboard → SQL Editor → New query → Run (this file).
--
-- What changed vs 0001:
--   * `user_id` is no longer a hard FK to auth.users. Hides are now a GLOBAL
--     preference (like "editing the site"), so everyone who opens the site —
--     signed in or not — sees the same hidden set.
--   * SELECT is open to everyone (including anonymous), because the UI must
--     filter for all visitors.
--   * INSERT/UPDATE/DELETE are restricted to an APPROVER account via auth
--     email allow-list. Other visitors can read but cannot mutate hides.
--   * Existing rows keep their `user_id` (now nullable + no FK) so a previous
--     owner's hides survive the migration; they are read by everyone.
-- ============================================================================

-- 1) Drop the hard FK + NOT NULL so hides are not bound to an auth user.
alter table public.hidden_tasks
  drop constraint if exists hidden_tasks_user_id_fkey;
alter table public.hidden_tasks
  alter column user_id drop not null;

-- 2) Global identity: exactly one row per hidden task regardless of who hid it.
--    The old (user_id, task_key) uniqueness is replaced by a global task_key.
drop constraint if exists hidden_tasks_user_task_key_key;
alter table public.hidden_tasks
  add constraint hidden_tasks_task_key_key unique (task_key);

-- 3) Drop the now-wrong per-user indexes (optional; keep until reindexed).
drop index if exists hidden_tasks_user_key_idx;
drop index if exists hidden_tasks_user_id_idx;
create index if not exists hidden_tasks_task_key_idx on public.hidden_tasks (task_key);

-- 4) Reset Row Level Security for the global model.
alter table public.hidden_tasks disable row level security;
alter table public.hidden_tasks enable row level security;

-- Re-create policies from scratch (drop old per-user AND any prior owner ones
-- so THIS file is idempotent — safe to re-run if a partial run errored).
drop policy if exists "hidden_tasks_select_own" on public.hidden_tasks;
drop policy if exists "hidden_tasks_insert_own" on public.hidden_tasks;
drop policy if exists "hidden_tasks_update_own" on public.hidden_tasks;
drop policy if exists "hidden_tasks_delete_own" on public.hidden_tasks;
drop policy if exists "hidden_tasks_select_public" on public.hidden_tasks;
drop policy if exists "hidden_tasks_insert_owner" on public.hidden_tasks;
drop policy if exists "hidden_tasks_update_owner" on public.hidden_tasks;
drop policy if exists "hidden_tasks_delete_owner" on public.hidden_tasks;

-- READ: everyone (anonymous included) can see the hidden set.
create policy "hidden_tasks_select_public" on public.hidden_tasks
  for select using (true);

-- WRITE: only the approved owner(s) may insert/update/delete.
--   Replace 'PLEASE-REPLACE@example.com' below with the owner's email, or
--   leave the function returning false to lock writes until you set it.
create or replace function public.is_hidden_tasks_owner()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) in (
        lower('theerawat.numtang@gmail.com')
      )
  );
$$;

create policy "hidden_tasks_insert_owner" on public.hidden_tasks
  for insert with check (public.is_hidden_tasks_owner());

create policy "hidden_tasks_update_owner" on public.hidden_tasks
  for update using (public.is_hidden_tasks_owner()) with check (public.is_hidden_tasks_owner());

create policy "hidden_tasks_delete_owner" on public.hidden_tasks
  for delete using (public.is_hidden_tasks_owner());

-- 5) Realtime stays so hides propagate live across devices/tabs.
alter publication supabase_realtime add table public.hidden_tasks;

-- 6) Drop the (optional) old per-user force-user_id trigger if it ever existed.
drop function if exists public.hidden_tasks_force_user_id();
drop trigger if exists hidden_tasks_force_user_id_trigger on public.hidden_tasks;

-- ============================================================================
-- Verification (paste into SQL Editor):
--   select count(*) from hidden_tasks;                        -- your rows survive
--   select * from pg_policies where tablename='hidden_tasks'; -- 4 new policies
-- ============================================================================