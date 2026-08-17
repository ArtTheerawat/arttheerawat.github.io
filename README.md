# TheeDeck

ศูนย์บัญชาการส่วนตัวของธีรวัฒน์ — ตารางเรียน, งาน (จาก Google Classroom), เทรด, ฝึกฟัง + AI token usage.

โปรเจกต์ Next.js 14 (App Router) นี้เดิมเป็น static site ที่ข้อมูลงานซิงก์จาก Google Classroom/Calendar ผ่านสคริปต์ (`generate_data.py` → `public/data/*.json`).

## ฟีเจอร์ "ซ่อนงาน" (ซิงก์ข้ามอุปกรณ์)

ฟีเจอร์ซ่อนงานเก็บสถานะไว้ใน **`localStorage`** (แยกตามเบราว์เซอร์/อุปกรณ์ — ซ่อนบนคอมเห็นบนมือถือไม่ได้) → ย้ายไปเก็บใน **Supabase (Postgres)** แทน เพื่อให้ซิงก์ข้ามอุปกรณ์ได้จริง และเป็น per-user preference (ROW LEVEL SECURITY คุ้มครอง).

### สรุปสถาปัตยกรรม

| ไฟล์ | บทบาท |
|---|---|
| `lib/hidden-tasks.ts` | Data layer + `useHiddenTasks()` hook (async ไป Supabase + realtime sync) |
| `lib/supabase/client.ts` | Browser client (env-missing → return null, ไม่ทำให้หน้าเว็บพัง) |
| `lib/supabase/server.ts` | Server client สำหรับ auth callback / sign-out |
| `lib/supabase/types.ts` | Type ของ `hidden_tasks` table |
| `middleware.ts` | รีเฟรช auth session ทุก request |
| `app/auth/callback/route.ts` | OAuth callback (แลก code → session) |
| `app/auth/sign-out/route.ts` | Sign out |
| `components/AuthStatus.tsx` | Auth chip ใน nav (login/logout) |
| `supabase/migrations/0001_create_hidden_tasks.sql` | ตาราง + RLS + policies + realtime |
| `.env.example` | ตัวอย่าง env vars |

- **ข้อมูลต้นทาง (`public/data/assignments.json`) ไม่ถูกแตะ** — การซ่อนเป็นแค่ preference ต่อผู้ใช้เท่านั้น
- **Task key = `course|title|due`** — ถ้าอาจารย์เปลี่ยนวันส่ง (due เปลี่ยน) key เปลี่ยน → งานกลับมาแสดงเป็น "งานใหม่" (กันพลาดกำหนดส่ง)

### ขั้นตอนตั้งค่า Supabase

> Supabase ต้องผูกบัตรชำระเงินตอนสมัคร (free tier ไม่มีค่าใช้จ่าย) — เป็นข้อกำหนดของ Supabase ทุกบัญชี.

1. **สร้างโปรเจกต์** — ไป [supabase.com](https://supabase.com) → New project → ตั้งชื่อ + เลือก region → Create. ใช้ free tier ได้ (ไม่เสียเงิน).

2. **เปิด Google sign-in** — Supabase Dashboard → **Authentication → Providers → Google** → Enable. ตั้งค่า:
   - ไป Google Cloud Console → สร้าง OAuth 2.0 Client ID (Web application) ของโปรเจกต์
   - Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - นำ `Client ID` / `Client Secret` กลับมาใส่ในช่องของ Supabase → Save

3. **รัน migration (สร้างตาราง + RLS)** — Supabase Dashboard → **SQL Editor** → New query → วางเนื้อหาทั้งไฟล์ `supabase/migrations/0001_create_hidden_tasks.sql` → Run.
   - ควรได้: ตาราง `hidden_tasks`, 4 policies (select/insert/update/delete), realtime publication เปิดแล้ว.

4. **ดึง project credentials** — Supabase Dashboard → **Project Settings → API** → คัดลอก:
   - `Project URL`
   - `anon` / `public` key

5. **ตั้ง env vars** —
   - **Vercel (production)**: Project → Settings → Environment Variables → เพิ่ม `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - **Local dev**: copy `.env.example` → `.env.local` แล้วใส่ค่าเดียวกัน.

   ขั้นตอนบน local:

   ```
   cp .env.example .env.local   # Windows: copy .env.example .env.local
   # แล้วแก้ .env.local ใส่ค่าจริง
   npm run dev
   ```

### วิธีทดสอบ

1. ล็อกอิน Google จากคอม (ปุ่ม "เข้าสู่ระบบ" ที่ nav หรือปุ่ม 🔒 บนงานที่อยากซ่อน)
2. กดซ่อนงานบนคอม
3. เปิดเว็บเดียวกันบนมือถือ (ล็อกอินบัญชีเดียวกัน) → งานนั้นต้องไม่แสดง
4. นำงานกลับมาบนมือถือ → คอมเห็นงานกลับมา (realtime ทันที / เมื่อโฟกัสแท็บ)
5. ล็อกอิน/ดูบัญชีอื่น → ไม่เห็นรายการซ่อนของอีกบัญชี (RLS บังคับ)

### ตาราง `hidden_tasks` (schema)

| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| `id` | uuid PK | default gen_random_uuid() |
| `user_id` | uuid FK → auth.users | on delete cascade |
| `task_key` | text | course\|title\|due |
| `course` | text | |
| `title` | text | |
| `due` | text nullable | |
| `reason` | text | wrong-due / already-submitted / cancelled / other |
| `custom_reason` | text nullable | เมื่อ reason = other |
| `hidden_at` | timestamptz | default now() |

- Unique: **(user_id, task_key)** → re-hide เป็น idempotent upsert
- RLS: ผู้ใช้เห็น/แก้ได้เฉพาะแถวของตัวเองเท่านั้น (`auth.uid() = user_id`)

## มีคำถาม?

- Supabase free tier quota / บัญชี → [supabase.com/docs](https://supabase.com/docs)
- โครงสร้างโปรเจกต์ → [Next.js App Router docs](https://nextjs.org/docs/app)