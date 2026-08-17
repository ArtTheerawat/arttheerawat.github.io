-- ============================================================================
-- Theedeck hidden_tasks — FIX: ทำให้ user_id เป็น nullable (จบปัญหา not-null)
-- ----------------------------------------------------------------------------
-- ต้นเหตุ "ซ่อนงานไม่สำเร็จ — null value in column "user_id" ... violates
-- not-null constraint": ตาราง live ยังมี `user_id ... NOT NULL` (จาก migration
-- 0001) และ migration 0002/0003 ที่พยายาม `drop not null` ไม่เคยลงจริง
-- (รันไม่ครบ/มี error ตรงกลาง) บน live table.
--
-- ไฟล์นี้แก้ที่ schema ให้ตรงกับ "global model" อย่างแท้จริง: user_id กลายเป็น
-- คอลัมน์ optional (เก็บไว้เผื่อ legacy / กันข้อมูลเดิมพัง) ไม่ผูกกับ auth user
-- แล้ว client ไม่จำเป็นต้องส่ง user_id อีกต่อไป
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งหมด -> Run
-- ไฟล์นี้ idempotent (รันซ้ำได้ ไม่พัง) และปลอดภัยต่อข้อมูลเดิม
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────
-- 1) user_id กลายเป็น nullable (global model ไม่ผูกกับผู้ใช้)
--    ตาราง live ยัง NOT NULL → บังคับให้ปลดออก
-- ──────────────────────────────────────────────────────────────────────────
alter table public.hidden_tasks
  alter column user_id drop not null;

-- ──────────────────────────────────────────────────────────────────────────
-- 2) ตรวจว่า FK ไป auth.users หายแล้วจริง (global ไม่ควรผูก) — ถ้ายังมีให้ลบ
--    (idempotent: DROP IF EXISTS เงียบถ้าไม่เจอ)
-- ──────────────────────────────────────────────────────────────────────────
alter table public.hidden_tasks
  drop constraint if exists hidden_tasks_user_id_fkey;

-- ──────────────────────────────────────────────────────────────────────────
-- ตรวจ (ควรได้):
--   select is_nullable from information_schema.columns
--     where table_name='hidden_tasks' and column_name='user_id';
--     -- ควร return 'YES'
--   select distinct task_key from public.hidden_tasks;  -- ข้อมูลเดิมยังครบ
-- ============================================================================