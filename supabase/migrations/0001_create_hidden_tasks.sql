-- ============================================================================
-- Theedeck hidden-tasks cloud sync — Supabase migration
-- ----------------------------------------------------------------------------
-- Run this in the Supabase Dashboard → SQL Editor → New query → Run.
-- It creates the `hidden_tasks` table, enables Row Level Security scoping every
-- row to its owning user, and enables realtime so hides propagate live across
-- devices.
-- ============================================================================

-- 1) The table. `id` is a UUID PK; `(user_id, task_key)` is unique so re-hiding
--    the same assignment is an idempotent upsert.
create table if not exists public.hidden_tasks (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_key text not null,
  course text not null default '',
  title text not null default '',
  due text,
  reason text not null,
  custom_reason text,
  hidden_at timestamptz not null default now(),
  constraint hidden_tasks_user_task_key_key unique (user_id, task_key)
);

-- Index for the per-user equality filter used by queries + RLS + realtime.
create index if not exists hidden_tasks_user_id_idx on public.hidden_tasks (user_id);
create index if not exists hidden_tasks_user_key_idx on public.hidden_tasks (user_id, task_key);

comment on table public.hidden_tasks is
  'Per-user hidden-assignment preferences. Never stores assignment source data; only the task key + labels needed to filter the UI.';

-- 2) Row Level Security — enabled, with policies so a user can only SELECT /
--    INSERT / UPDATE / DELETE their own rows. `user_id` is forced to
--    auth.uid() on every write so nobody can write rows for another user.
alter table public.hidden_tasks enable row level security;

-- Read: users see only their own rows.
create policy "hidden_tasks_select_own" on public.hidden_tasks
  for select using (auth.uid() = user_id);

-- Insert: users create rows for themselves only.
create policy "hidden_tasks_insert_own" on public.hidden_tasks
  for insert with check (auth.uid() = user_id);

-- Update: users update only their own rows.
create policy "hidden_tasks_update_own" on public.hidden_tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Delete: users delete only their own rows.
create policy "hidden_tasks_delete_own" on public.hidden_tasks
  for delete using (auth.uid() = user_id);

-- 3) Realtime — publish changes so the open tab/device updates instantly when
--    a hide happens elsewhere (phone -> computer sync, and same-device tabs).
alter publication supabase_realtime add table public.hidden_tasks;

-- 4) (Optional) Triggers to guarantee user_id is always the authenticated user
--    even if a client sends a different value. Uncomment if you want a hard
--    server-side guard (recommended for defence-in-depth, though the RLS
--    policies above already enforce it).
-- create or replace function public.hidden_tasks_force_user_id()
-- returns trigger language plpgsql security definer as $$
-- begin
--   new.user_id := auth.uid();
--   return new;
-- end; $$;
-- drop trigger if exists hidden_tasks_force_user_id_trigger on public.hidden_tasks;
-- create trigger hidden_tasks_force_user_id_trigger
--   before insert or update on public.hidden_tasks
--   for each row execute function public.hidden_tasks_force_user_id();

-- ============================================================================
-- Verification queries (paste into SQL Editor to confirm):
--   select table_name from information_schema.tables where table_schema='public';
--   select count(*) from hidden_tasks;             -- expect 0 (empty at first)
--   select * from pg_policies where tablename='hidden_tasks';  -- 4 policies
-- ============================================================================