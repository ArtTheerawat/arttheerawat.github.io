-- ============================================================================
-- Theedeck classroom link overrides — Supabase migration 0009
-- ----------------------------------------------------------------------------
-- Lets the owner customise the "ไปที่ Classroom" deep link per assignment.
-- Default link (courseId + courseworkId) is computed from classroom.json; a row
-- here (keyed by the google assignment id == classroom_tasks.task_key) OVERRIDES
-- that default, so the user can paste a working URL when the auto one spins.
-- ----------------------------------------------------------------------------
-- Design mirror of hidden_tasks (global model): rows are global (no user_id),
-- the owner may only write them (RLS gated), everyone may read them (the
-- static /today + Home modals render the link server-side/client-side).
-- ============================================================================

create table if not exists public.classroom_link_overrides (
  id         uuid not null default gen_random_uuid() primary key,
  task_key   text not null unique,          -- google assignment id (classroom_tasks.task_key)
  url        text not null,                 -- fully-qualified https:// URL the user chose
  note       text,                          -- optional short label (unused so far)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.classroom_link_overrides is
  'Per-assignment manual override for the ไปที่ Classroom deep link. task_key = google assignment id.';

-- ----------------------------------------------------------------------------
-- Row Level Security: everyone can SELECT (so the modals render overrides), but
-- ONLY the owner (theerawat.numtang@gmail.com) can INSERT/UPDATE/DELETE. Gated
-- exactly like the hidden_tasks owner gate via the "authenticated + role". The
-- RLS check uses raw email comparison on auth.jwt() so no extra table is needed
-- -- same trick the trading dashboard uses for admin grants.
-- ----------------------------------------------------------------------------
alter table public.classroom_link_overrides enable row level security;

create policy "classroom_link_overrides_select_all"
  on public.classroom_link_overrides
  for select using (true);

-- Owner-only writes. Reuses the existing public.is_hidden_tasks_owner()
-- function (migration 0002) as the single source of truth for the owner email,
-- so a change to the allowed account touches ONE place (0002), not here too.
-- Everyone else (anon or other accounts) is denied silently.
create policy "classroom_link_overrides_insert_owner"
  on public.classroom_link_overrides
  for insert with check (public.is_hidden_tasks_owner());

create policy "classroom_link_overrides_update_owner"
  on public.classroom_link_overrides
  for update using (public.is_hidden_tasks_owner()) with check (public.is_hidden_tasks_owner());

create policy "classroom_link_overrides_delete_owner"
  on public.classroom_link_overrides
  for delete using (public.is_hidden_tasks_owner());

-- psql / Supabase dashboard client runs as postgres or anon: SELECT grant for
-- anon + authenticated is required for the browser client (same 42501 lesson as
-- the classroom/trading tables). Writes are RLS-gated to the owner email above.
grant select on public.classroom_link_overrides to anon, authenticated;
grant insert, update, delete on public.classroom_link_overrides to authenticated;

-- ============================================================================
-- Verification queries (paste into SQL Editor to confirm):
--   select table_name from information_schema.tables
--     where table_schema='public' and table_name ilike 'classroom%' order by 1;
--   select tablename, policyname from pg_policies
--     where schemaname='public' and tablename like 'classroom_link%' order by 1;
--   -- expect: select_all + write_owner + update_owner + delete_owner (4 rows)
-- ============================================================================