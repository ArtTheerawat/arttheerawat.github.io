-- ============================================================================
-- Theedeck Notification Center — Supabase migration
-- ----------------------------------------------------------------------------
-- Centralized notification read-state for the personal hub (SYSTEM 5).
--
-- CONCEPT: notifications are DERIVED data. lib/notifications.ts computes
-- notification items deterministically in the browser from the SAME data files
-- the pages already read (public/data/assignments.json + schedule.json +
-- classroom.json). No cron, no AI, no duplicated business logic. So this table
-- stores ONLY the READ / UNREAD state, keyed by a stable notif_key — the dedup
-- mechanism that stops "opening /today" from creating duplicates (a key that
-- already exists is never re-created; a key the page simply recomputes is the
-- same single notification).
--
-- RLS design (keeps it small + resilient — mirrors hidden_tasks / link-overrides):
--   * WRITE (mark read / mark all read) = owner-only, via is_hidden_tasks_owner()
--     (the same approved-owner allow-list function the other tables reuse —
--     single source of truth for "who can persist state").
--   * READ is public (anon SELECT) so the badge can resolve read/unread for any
--     visitor; anonymous/non-owner visitors fall back to localStorage read-state
--     in the hook if their write is rejected / backend is down — web
--     notifications remain functional even if the external sync fails.
--   * Real-time publication added so a "mark read" on the phone updates the open
--     computer tab immediately (same pattern as hidden_tasks).
-- ============================================================================

-- 1) notifications — one row per notif_key read-state.
create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  notif_key  text unique not null,             -- stable dedup key (see lib/notifications.ts)
  read       boolean not null default false,
  read_at    timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notifications_read_idx on public.notifications (read);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.notifications enable row level security;

-- READ: ใส่ policy เปิดไว้เพื่อให้ badge/unread นับได้ทั้งคนที่ login และไม่ login
drop policy if exists "notifications_select_public" on public.notifications;
create policy "notifications_select_public" on public.notifications
  for select using (true);

-- WRITE: เจ้าของเท่านั้น (reuse is_hidden_tasks_owner — ฟังก์ชัน allow-list เดียวกัน)
drop policy if exists "notifications_insert_owner" on public.notifications;
create policy "notifications_insert_owner" on public.notifications
  for insert with check (public.is_hidden_tasks_owner());

drop policy if exists "notifications_update_owner" on public.notifications;
create policy "notifications_update_owner" on public.notifications
  for update using (public.is_hidden_tasks_owner()) with check (public.is_hidden_tasks_owner());

drop policy if exists "notifications_delete_owner" on public.notifications;
create policy "notifications_delete_owner" on public.notifications
  for delete using (public.is_hidden_tasks_owner());

-- GRANT: anon อ่านได้ (badge), authenticated อ่าน+เขียน (owner จะถูก RLS กรองอีกที)
grant select on table public.notifications to anon, authenticated;
grant select, insert, update, delete on table public.notifications to authenticated;

-- service_role bypasses RLS (บริหาร/cleanup)
grant select, insert, update, delete on table public.notifications to service_role;

-- Real-time (safe on re-run)
do $$
begin
  if not exists (
    select 1
    from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname = 'supabase_realtime'
      and n.nspname = 'public'
      and c.relname = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ============================================================================
-- ตรวจ:
--   select tablename, policyname from pg_policies
--     where schemaname='public' and tablename='notifications' order by 1;
--     -- คาดเห็น: notifications_select_public / _insert_owner / _update_owner / _delete_owner
-- ============================================================================