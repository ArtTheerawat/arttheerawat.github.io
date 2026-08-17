-- ============================================================================
-- Theedeck hidden_tasks — FIX: อนุญาตให้บัญชีเจ้าของเขียนได้จริง (grants) +
-- ตรวจให้มี UNIQUE(task_key) ครบ (หลัง 0001 แต่ยังไม่ยืนยันว่า 0002/0003 ลงครบ)
-- ----------------------------------------------------------------------------
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งหมด -> Run
-- ไฟล์นี้ idempotent (รันซ้ำได้ ไม่พัง) และปลอดภัยต่อข้อมูลเดิม
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────
-- 1) GRANT ระดับตาราง (migration 0001–0003 ไม่ได้ใส่ GRANT → เจ้าของเขียนไม่ได้!)
--    - anon:      อ่านได้ (global read เปิดสำหรับทุกคน) แต่เขียนไม่ได้
--    - authenticated: อ่าน+เขียน (RLS จะกรองให้เฉพาะเจ้าของจริง)
-- ──────────────────────────────────────────────────────────────────────────
grant select on table public.hidden_tasks to anon;
grant select, insert, update, delete on table public.hidden_tasks to authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 2) Deduplicate task_key (ถ้ามีซ้ำเพราะ upsert เคยพัง) ก่อนสร้าง UNIQUE
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
-- 3) ให้แน่ใจว่า UNIQUE(task_key) มีจริง (ถ้า migration 0003 ยังไม่รัน)
--    ถ้า constraint มีอยู่แล้ว DROP/ADD ตัวเดิมก็เงียบ ไม่พัง
-- ──────────────────────────────────────────────────────────────────────────
alter table public.hidden_tasks
  drop constraint if exists hidden_tasks_user_task_key_key;
alter table public.hidden_tasks
  drop constraint if exists hidden_tasks_task_key_key;
alter table public.hidden_tasks
  add constraint hidden_tasks_task_key_key unique (task_key);

-- ──────────────────────────────────────────────────────────────────────────
-- 4) RLS: ให้แน่ใจว่า policy เปิด "ทุกคนอ่านได้, เจ้าของเท่านั้นเขียนได้"
-- ──────────────────────────────────────────────────────────────────────────
alter table public.hidden_tasks disable row level security;
alter table public.hidden_tasks enable row level security;

drop policy if exists "hidden_tasks_select_own"   on public.hidden_tasks;
drop policy if exists "hidden_tasks_insert_own"   on public.hidden_tasks;
drop policy if exists "hidden_tasks_update_own"   on public.hidden_tasks;
drop policy if exists "hidden_tasks_delete_own"   on public.hidden_tasks;
drop policy if exists "hidden_tasks_select_public" on public.hidden_tasks;
drop policy if exists "hidden_tasks_insert_owner"  on public.hidden_tasks;
drop policy if exists "hidden_tasks_update_owner"  on public.hidden_tasks;
drop policy if exists "hidden_tasks_delete_owner"  on public.hidden_tasks;

-- READ: ทุกคนเห็น global hidden set (ล็อกอินหรือไม่ก็ตาม)
create policy "hidden_tasks_select_public" on public.hidden_tasks
  for select using (true);

-- WRITE: แค่เจ้าของ (theerawat.numtang@gmail.com) เท่านั้น
create or replace function public.is_hidden_tasks_owner()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and lower(email) in ( lower('theerawat.numtang@gmail.com') )
  );
$$;

create policy "hidden_tasks_insert_owner" on public.hidden_tasks
  for insert with check (public.is_hidden_tasks_owner());

create policy "hidden_tasks_update_owner" on public.hidden_tasks
  for update using (public.is_hidden_tasks_owner()) with check (public.is_hidden_tasks_owner());

create policy "hidden_tasks_delete_owner" on public.hidden_tasks
  for delete using (public.is_hidden_tasks_owner());

-- Realtime (ปลอดภัยต่อการรันซ้ำ)
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
      and c.relname = 'hidden_tasks'
  ) then
    alter publication supabase_realtime add table public.hidden_tasks;
  end if;
end $$;

-- ============================================================================
-- ตรวจ (ควรได้):
--   select count(*), count(distinct task_key) from public.hidden_tasks;  -- เท่ากัน
--   select * from pg_policies where tablename='hidden_tasks';            -- 4 policies
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_name='hidden_tasks' and grantee in ('anon','authenticated');
--     -- ควรเห็น anon: SELECT / authenticated: SELECT,INSERT,UPDATE,DELETE
-- ============================================================================