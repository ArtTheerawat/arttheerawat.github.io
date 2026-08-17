-- ============================================================================
-- Theedeck hidden-tasks — make GLOBAL, robust against the ACTUAL live schema.
-- ----------------------------------------------------------------------------
-- Why a NEW file (not 0002): the live `hidden_tasks` table differs from the
-- designed 0001:
--   * NO unique constraint on (user_id, task_key) or task_key
--   * FK `hidden_tasks_user_id_fkey` WITHOUT on delete cascade
-- The previous upsert used `onConflict: "task_key"`, which ERRORED on this
-- schema ("no unique or exclusion constraint matching on conflict spec") and
-- may have produced DUPLICATE task_key rows. This file handles that.
--
-- To run: Supabase Dashboard → SQL Editor → New query → paste → Run.
-- This file is IDEMPOTENT (safe to re-run after a partial/errored run).
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────
-- 1) De-duplicate task_key BEFORE adding a UNIQUE constraint.
--    Keep one row per task_key (the newest hidden_at), delete the rest.
--    A unique constraint can only be added when the column has no dups.
-- ──────────────────────────────────────────────────────────────────────────
delete from public.hidden_tasks h
where h.id in (
  select id from (
    select id,
           row_number() over (
             partition by task_key
             order by hidden_at desc, id desc
           ) as rn
    from public.hidden_tasks
  ) t
  where t.rn > 1
);

-- ──────────────────────────────────────────────────────────────────────────
-- 2) De-globalise: free the table from the auth user binding.
--    SQL names come from the LIVE schema (DROP ... IF EXISTS is harmless if
--    already absent).
-- ──────────────────────────────────────────────────────────────────────────
-- Drop the FK to auth.users (name matches the live constraint).
alter table public.hidden_tasks
  drop constraint if exists hidden_tasks_user_id_fkey;

-- user_id is now optional (legacy rows keep it; new global rows have NULL).
alter table public.hidden_tasks
  alter column user_id drop not null;

-- ──────────────────────────────────────────────────────────────────────────
-- 3) Global identity: exactly one row per hidden task, regardless of who hid.
--    (Dedupe in step 1 makes this additive-safe.)
-- ──────────────────────────────────────────────────────────────────────────
-- Drop any partial/prior unique constraints we may have created.
alter table public.hidden_tasks
  drop constraint if exists hidden_tasks_task_key_key;
alter table public.hidden_tasks
  drop constraint if exists hidden_tasks_user_task_key_key;

-- Add the global uniqueness now that the data is clean.
alter table public.hidden_tasks
  add constraint hidden_tasks_task_key_key unique (task_key);

-- Index to support the global lookup.
drop index if exists hidden_tasks_user_key_idx;
drop index if exists hidden_tasks_user_id_idx;
create index if not exists hidden_tasks_task_key_idx on public.hidden_tasks (task_key);

-- ──────────────────────────────────────────────────────────────────────────
-- 4) Row Level Security → GLOBAL read, OWNER-only write.
-- ──────────────────────────────────────────────────────────────────────────
alter table public.hidden_tasks disable row level security;
alter table public.hidden_tasks enable row level security;

-- Drop old per-user policies and any prior owner policies (idempotent):
drop policy if exists "hidden_tasks_select_own"   on public.hidden_tasks;
drop policy if exists "hidden_tasks_insert_own"   on public.hidden_tasks;
drop policy if exists "hidden_tasks_update_own"   on public.hidden_tasks;
drop policy if exists "hidden_tasks_delete_own"   on public.hidden_tasks;
drop policy if exists "hidden_tasks_select_public" on public.hidden_tasks;
drop policy if exists "hidden_tasks_insert_owner"  on public.hidden_tasks;
drop policy if exists "hidden_tasks_update_owner"  on public.hidden_tasks;
drop policy if exists "hidden_tasks_delete_owner"  on public.hidden_tasks;

-- READ: everyone (signed in or not) sees the GLOBAL hidden set.
create policy "hidden_tasks_select_public" on public.hidden_tasks
  for select using (true);

-- WRITE: only the approved owner(s) may insert/update/delete.
--   Owner email is set below. If you need a different account, edit here.
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

-- ──────────────────────────────────────────────────────────────────────────
-- 5) Realtime stays so hides propagate live across devices/tabs.
-- ──────────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.hidden_tasks;

-- ──────────────────────────────────────────────────────────────────────────
-- 6) Cleanup of any optional per-user trigger (harmless if absent).
-- ──────────────────────────────────────────────────────────────────────────
drop function if exists public.hidden_tasks_force_user_id();
drop trigger if exists hidden_tasks_force_user_id_trigger on public.hidden_tasks;

-- ============================================================================
-- Verification (paste into SQL Editor after the run):
--   select count(*), count(distinct task_key) from public.hidden_tasks;
--     -- counts equal  ⇨ no duplicates remain, unique constraint holds
--   select * from pg_policies where tablename = 'hidden_tasks';
--     -- 4 policies: select_public + insert/update/delete_owner
--   select * from information_schema.table_constraints
--     where table_name = 'hidden_tasks';
--     -- pkey + unique(task_key) present; user_id FK gone
-- ============================================================================