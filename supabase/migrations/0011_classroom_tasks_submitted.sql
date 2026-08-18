-- ============================================================================
-- Add `submitted` (student turn-in state) to classroom_tasks
-- ----------------------------------------------------------------------------
-- The /classroom page needs to know which assignments the student has already
-- turned in, so it can (a) drop them from the "pending / overdue / due soon"
-- buckets (a completed assignment is not something to remind about) and (b) tag
-- the remaining ones that still show with a "ส่งแล้ว ✅" badge. Previously
-- classroom_sync.py only pulled coursework `state` (PUBLISHED/DRAFT) and never
-- the per-student submission state, so every published task looked pending.
--
-- This mirrors the trading tables delta pattern: run in Supabase SQL Editor.
-- ALTER .. ADD COLUMN IF NOT EXISTS so re-running is safe. `submitted` is a
-- plain boolean; the browser anon/authenticated SELECT already grants * (columns
-- are covered by the existing `grant select on classroom_tasks`).
-- ============================================================================

alter table public.classroom_tasks
  add column if not exists submitted boolean;

-- backfill nothing here — classroom_sync.py recomputes it on next run.