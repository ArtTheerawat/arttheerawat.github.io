-- ============================================================================
-- Theedeck classroom data — Supabase migration
-- ----------------------------------------------------------------------------
-- Source for the /classroom page: Google Classroom coursework + announcements
-- pulled by classroom_sync.py (Hermes cron, no_agent). Mirrors the trading
-- tables design (0006):
--   * RLS read-only public — anon + authenticated can SELECT; anon can NEVER
--     write (RLS enabled, no insert/update/delete policies).
--   * All writes via the Python sync script using SERVICE_ROLE (bypasses RLS).
--   * sync_state / heartbeat rows stamped per service so the ops pages and
--     dead-man's switch can see classroom_sync health.
--   * A fine-grained table-level GRANT SELECT to anon AND authenticated is
--     required (@supabase/ssr browser client authenticates as "authenticated"
--     even when logged out — same lesson as the trading tables).
-- ============================================================================

-- 1) classroom_tasks — one row per published Google Classroom assignment.
create table if not exists public.classroom_tasks (
  id          bigint generated always as identity primary key,
  task_key    text unique not null,             -- google assignment id (upsert key)
  course_name text,
  course_id   text,
  title       text,
  due         date,                             -- YYYY-MM-DD (assignment dueDate)
  due_time    text,                             -- HH:MM from dueTime
  state       text,                             -- PUBLISHED / DRAFT / ...
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists classroom_tasks_due_idx on public.classroom_tasks (due);
create index if not exists classroom_tasks_course_idx on public.classroom_tasks (course_id);

-- 2) classroom_announcements — one row per Google Classroom announcement.
create table if not exists public.classroom_announcements (
  id          bigint generated always as identity primary key,
  ann_key     text unique not null,             -- google announcement id (upsert key)
  course_name text,
  course_id   text,
  text        text,
  "time"      timestamptz,                      -- creationTime
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists classroom_ann_time_idx on public.classroom_announcements ("time" desc);

-- 3) classroom_sync_state — optional watermark for the sync service
--    (reuses the shared sync_state table instead where possible; this one is
--     just a convenience, not required by the page).
create table if not exists public.classroom_meta (
  id           bigint generated always as identity primary key,
  key          text unique not null,
  value        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- classroom_tasks: anon may SELECT (static page reads). No anon write policy.
alter table public.classroom_tasks enable row level security;
create policy "classroom_tasks_select_public" on public.classroom_tasks
  for select using (true);

-- classroom_announcements: anon may SELECT.
alter table public.classroom_announcements enable row level security;
create policy "classroom_ann_select_public" on public.classroom_announcements
  for select using (true);

-- classroom_meta: operational — NOT exposed to anon.
alter table public.classroom_meta enable row level security;

-- service_role gets full read+write+delete (bypasses RLS for the sync script).
grant select, insert, update, delete
  on public.classroom_tasks, public.classroom_announcements, public.classroom_meta
  to service_role;

-- Browser anon/authenticated read for the static page (GRANT is required in
-- addition to the policy — same 42501 lesson as the trading tables).
grant select on public.classroom_tasks        to anon, authenticated;
grant select on public.classroom_announcements to anon, authenticated;

-- ============================================================================
-- Verification queries:
--   select table_name from information_schema.tables
--     where table_schema='public' and table_name ilike 'classroom%' order by 1;
--   select tablename, policyname from pg_policies
--     where schemaname='public' and tablename ilike 'classroom%' order by 1;
-- ============================================================================