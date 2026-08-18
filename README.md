# TheeDeck

ศูนย์บัญชาการส่วนตัวของธีรวัฒน์ — ตารางเรียน, งาน (จาก Google Classroom), เทรด (XAUUSD/BTC), ฝึกฟัง + AI token usage.

โปรเจกต์ **Next.js 14 (App Router)** เดิมเป็น static site ที่ข้อมูลงานซิงก์จาก Google Classroom/Calendar ผ่านสคริปต์ (`generate_data.py` → `public/data/*.json`). ปัจจุบันมี **Supabase (Postgres)** เป็น cloud backend สำหรับ data ที่ต้องซิงก์ข้ามอุปกรณ์ (hidden-tasks, trading, classroom) พร้อม fallback เป็น static JSON เมื่อไม่มี backend

---

## สถาปัตยกรรม (หลัง refactor แยก DB ออกจาก UI)

โปรเจกต์ **ไม่ผูกติด Supabase SDK กับ UI** โดยตรงอีกต่อไป — ข้อมูลผ่าน Database Adapter layer กลาง ดังนั้นวันหนึ่งถ้าอยากย้าย backend (เช่น Supabase → Cloudflare **D1**) **จะเปลี่ยนเฉพาะชั้น database เท่านั้น ไม่ต้องรื้อ UI หรือ Service**:

```
UI (pages / components)
   │  เรียกแค่ service function (ไม่รู้ว่าข้อมูลมาจากไหน)
   ▼
Service layer            lib/services/     · trading-service · classroom-service · hidden-tasks-service
   │  เรียกผ่าน getDb() contract เท่านั้น
   ▼
DatabaseAdapter          lib/db/adapter.ts (interface — ไร้ SDK, ไร้ column สไตล์ DB)
   │
   ▼
Supabase implementation  lib/db/supabase/adapter.ts   ← ที่เดียวใน app ที่แตะ @supabase/ssr
```

### ตารางไฟล์สำคัญของระบบข้อมูล

| ชั้น | ไฟล์ | บทบาท |
|---|---|---|
| **Domain models** | `lib/db/types.ts` | Data models กลาง (Trade, Signal, PerfDay, CourseGroup, HiddenTask, …) — ไร้ column สไตล์ Supabase/D1 |
| **Adapter contract** | `lib/db/adapter.ts` | `interface DatabaseAdapter` — สัญญาระหว่าง service กับ backend (`loadTrading()` / `loadClassroom()` / hidden-tasks / auth) |
| **Registry** | `lib/db/index.ts` | `getDb()` — จุดเดียวที่สลับ backend (ตอนนี้คืน SupabaseAdapter; ย้ายไป D1 ก็แก้ตรงนี้ที่เดียว) |
| **Supabase impl** | `lib/db/supabase/adapter.ts` | `SupabaseAdapter` — ที่เดียวใน app (นอก auth/middleware) ที่แตะ SDK; mapping snake_case → Domain model |
| **Service (trading)** | `lib/services/trading-service.ts` | `loadTrading()` — ครอบ "Supabase first, static JSON fallback" |
| **Service (classroom)** | `lib/services/classroom-service.ts` | `loadClassroom()` — ครอบ + group per-course + fallback |
| **Service (hidden)** | `lib/services/hidden-tasks-service.ts` | data access + realtime/auth subscribe ของ hidden set |
| **Hook/helper** | `lib/hidden-tasks.ts` | `useHiddenTasks()` + helpers — คง signature เดิมให้ UI ใช้ ไม่ผูก backend |
| **Auth internals** | `lib/supabase/client.ts` · `server.ts` · `types.ts` | Browser/server client + types (internal ของ adapter — UI ไม่เรียกตรงๆ) |
| **Auth routing** | `middleware.ts` · `app/auth/*` | รีเฟรช session + OAuth callback / sign-out (server-side auth — จงใจเข้าถึง SDK ตรงๆ) |
| **Auth chip** | `components/AuthStatus.tsx` | ปุ่ม login/logout ใน nav |
| **Migrations** | `supabase/migrations/` | SQL ระดับ backend (0001–0008) |

> **หลักการ:** UI กับ Service รู้จักแค่ `lib/db/types.ts` + `lib/db/adapter.ts` เท่านั้น. Column ชื่อ `task_key`, `hidden_at` (snake_case) ถูกซ่อนอยู่ใน adapter ตัวเดียว.

---

## ระบบข้อมูลย่อย (3 ชุด)

### 1. Hidden tasks (ซ่อนงาน — GLOBAL ซิงก์ข้ามอุปกรณ์)

- เก็บว่า "งานไหนที่ตัดสินใจซ่อน" ไว้ในตาราง `hidden_tasks` (เดิมเป็น per-user → ตอนนี้ **global**: ทุกคนที่เปิดเว็บเห็นชุดซ่อนเดียวกัน เหมือนการ "แก้ไขเว็บไซต์")
- **อ่านได้ทุกคน** (แม้ไม่ login) — ต้อง filter ให้ผู้เข้าชมทุกคนเห็นเหมือนกัน
- **เขียนได้เฉพาะ owner** — ผ่าน email allow-list ใน RLS (`is_hidden_tasks_owner()` ตรวจ `theerawat.numtang@gmail.com`)
- Realtime: เปลี่ยนฝั่งไหน อีกฝั่งอัปเดตทันที / เมื่อโฟกัสแท็บ
- **Task key = `course|title|due`** — ถ้าอาจารย์เปลี่ยนวันส่ง (due เปลี่ยน) key เปลี่ยน → งานกลับมาเป็น "งานใหม่" (กันพลาดกำหนดส่งจริง)
- ข้อมูลต้นทาง (`public/data/assignments.json`) **ไม่ถูกแตะ** — การซ่อนเป็นแค่ preference

### 2. Trading (เทรด)

- `trades` / `signals` / `trading_daily` → ผ่าน `loadTrading()` (migration 0006–0007)
- UI เรียก `loadTrading()` จาก service; ถ้า backend ว่าง/พัง → fallback เป็น `public/data.json` (Google Sheets auto-sync)

### 3. Classroom (งานวิชา)

- `classroom_tasks` / `classroom_announcements` → ผ่าน `loadClassroom()` (migration 0008)
- Service group งาน+ประกาศเป็น per-course ให้หน้า render; fallback → `public/data/classroom.json`

---

## แผนผัง migration ของ Supabase

| ไฟล์ | ทำอะไร |
|---|---|
| `0001_create_hidden_tasks.sql` | สร้างตาราง + RLS per-user + realtime (ของเดิม) |
| `0002_make_hidden_tasks_global.sql` | เปลี่ยนเป็น global (unique `task_key`, SELECT เปิด, WRITE เฉพาะ owner) |
| `0003_make_hidden_global_live.sql` | ปรับให้ global ใช้งานจริง |
| `0004_fix_owner_grants.sql` | แก้ GRANT/policy ของ owner |
| `0005_make_user_id_nullable.sql` | `user_id` เป็น null ได้ (ไม่ผูก auth user) |
| `0006_create_trading_tables.sql` | `trades` / `signals` / `trading_daily` |
| `0007_fix_dashboard_grant_authenticated.sql` | GRANT ให้ authed user อ่าน trading |
| `0008_create_classroom_tables.sql` | `classroom_tasks` / `classroom_announcements` |

---

## 🚚 วิธีถอย (Migrate) จาก Supabase → Cloudflare D1

สถาปัตยกรรมออกแบบมาให้ **เปลี่ยนเฉพาะชั้น DB** โดยไม่แตะ UI/Service. มี 4 ขั้นตอน:

### 1. เขียน D1 adapter ใหม่ (implements `DatabaseAdapter`)

`DatabaseAdapter` ใน `lib/db/adapter.ts` มี method ที่ UI ต้องการครบอยู่แล้ว (`loadTrading()`, `loadClassroom()`, `loadHiddenTasks()`, upsert/delete/clear hidden, `getUser()`, `signInWithGoogle()`, `subscribeHiddenTasks()`…). เขียน implementation ใหม่ เช่น `lib/db/d1/adapter.ts`:

```ts
// lib/db/d1/adapter.ts
import type { DatabaseAdapter } from "../adapter";
import type { Trade, CourseGroup, HiddenTask } from "../types";

export class D1Adapter implements DatabaseAdapter {
  readonly kind = "d1";

  // ตัวอย่าง: แทน Supabase .from("trades").select() → SQL ผ่าน binding env.DB (D1)
  async loadTrading() {
    const stmt = env.DB.prepare(
      "SELECT timestamp, symbol, direction, volume, entry, tp, sl, net_pnl, status FROM trades ORDER BY timestamp DESC LIMIT 300"
    );
    const rows = await stmt.all();
    return {
      ok: true,
      // mapping ตรงนี้ — คนเดียวกับที่ SupabaseAdapter ทำ แต่เป็นจาก row ของ D1
      trades: rows.results.map((r) => ({
        timestamp: r.timestamp, symbol: r.symbol, direction: r.direction,
        entry: r.entry != null ? String(r.entry) : undefined, /* … */ netPnl: r.net_pnl, status: r.status,
      })),
      signals: [],
      perf: [],
    };
  }
  // … implement loadClassroom, loadHiddenTasks, upsertHiddenTask, deleteHiddenTask,
  // clearHiddenTasks, subscribeHiddenTasks, getUser, getSessionUserId, signInWithGoogle, …
}
```

### 2. สลับ backend ใน registry จุดเดียว

`lib/db/index.ts` คือ**ที่เดียว**ที่ชี้ว่าใช้ adapter อะไร:

```ts
// lib/db/index.ts
import { SupabaseAdapter } from "./supabase/adapter";
// import { D1Adapter } from "./d1/adapter";   // ← ตัวใหม่

let db: DatabaseAdapter | null = null;
export function getDb(): DatabaseAdapter {
  db ??= new SupabaseAdapter();   // ← เปลี่ยนบรรทัดนี้เป็น new D1Adapter()
  return db;
}
```

> เปลี่ยนแค่นี้ — `pages` กับ `services` ไม่ได้ถูกแก้เลย. ถ้าอยากใช้ env var ตัดสินใจ (`DB_KIND==="d1"`) ก็ทำได้ที่ `getDb()` ตรงนี้.

### 3. สร้างตารางบน D1 ตาม Schema

เขียน file schema (เช่น `d1/schema.sql` / `migrations/`) มี table ตรงกับ domain models:

```sql
CREATE TABLE trades (
  timestamp TEXT, symbol TEXT, direction TEXT, volume REAL,
  entry TEXT, tp TEXT, sl TEXT, net_pnl REAL, status TEXT
);
CREATE TABLE hidden_tasks (
  task_key TEXT PRIMARY KEY,
  course TEXT, title TEXT, due TEXT,
  reason TEXT, custom_reason TEXT,
  hidden_at TEXT DEFAULT (datetime('now'))
);
-- … classroom_tasks, classroom_announcements, trading_daily …
```

### 4. ไล่ส่งผ่าน D1 (แทน Supabase env)

- ลบ `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- ต่อ D1 binding ตามวิธี deploy (Workers/Pages + D1) แล้ว inject ผ่าน `env.DB`
- ปรับ fallback: ถ้าคนมากกว่า 1 ปรับปรุง schema ให้รองรับได้เลย (ไม่ต้องรื้อโค้ด)

> **สิ่งที่ต้องยอมรับเมื่อย้าย D1:** ย้ายโค้ดชั้น DB เท่านั้น. Auth (Google sign-in ผ่าน Supabase) หรือ realtime (`subscribeHiddenTasks`) เป็น capability **เฉพาะ backend** — ถ้า D1 ไม่รองรับ ก็ adapter คืน `() => {}` (unsubscribe no-op) หรือใช้วิธี poll แทน. UI จะ fallback อย่างปลอดภัยอยู่แล้ว.

---

## ขั้นตอนตั้งค่า Supabase (ตอนนี้)

> Supabase ต้องผูกบัตรชำระเงินตอนสมัคร (free tier ไม่มีค่าใช้จ่าย) — เป็นข้อกำหนดของ Supabase. *(ถ้าหัวหน้ายังเข้าไม่ถึงบัตร → ดูส่วนถอยไป D1 ข้างบน เพราะ D1 มี free tier โดยไม่ผูกบัตร)*

1. **สร้างโปรเจกต์** — [supabase.com](https://supabase.com) → New project → ตั้งชื่อ + region → Create. ใช้ free tier ได้.
2. **เปิด Google sign-in** — Supabase Dashboard → **Authentication → Providers → Google** → Enable + ตั้งค่า OAuth (Client ID/Secret จาก Google Cloud Console, redirect `https://<ref>.supabase.co/auth/v1/callback`).
3. **รัน migration ทั้งหมด** — Supabase Dashboard → **SQL Editor** → New query → วางเนื้อหาไฟล์ `supabase/migrations/0001` → … → `0008` ตามลำดับ → Run. (0002–0005 เปลี่ยน hidden เป็น global; 0006–0008 สร้าง trading/classroom)
   - **สำคัญ:** migration 0002 มี `is_hidden_tasks_owner()` ซึ่ง hard-code email owner ไว้ (`theerawat.numtang@gmail.com`) — ตรวจให้ตรงกับบัญชีจริง
4. **ดึง project credentials** — Dashboard → **Project Settings → API** → คัดลอก `Project URL` + `anon` key.
5. **ตั้ง env vars** — copy `.env.example` → `.env.local` (Windows: `copy .env.example .env.local`) แล้วใส่ค่า:
   - `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` (production URL)
   - `NEXT_PUBLIC_HIDDEN_ALLOWED_EMAILS` = owner email (ให้ตรงกับ RLS ใน 0002)
   - `USAGE_ALLOWED_EMAILS` = email ที่ดู `/api/usage` ได้ (fail-closed: ว่าง = ทุกคนโดน 403)

---

## ขั้นตอน Deploy ขึ้น Vercel

1. **ตั้ง Auth URL configuration ที่ Supabase ก่อน** — Dashboard → **Authentication → URL Configuration**: Site URL = URL production จริง, Redirect URLs = `https://<app>.vercel.app/auth/callback*` + `http://localhost:3000/**` → Save. *(ถ้าข้าม ล็อกอินจะ redirect ไป localhost แล้วพัง)*
2. **Push โค้ดขึ้น git**:
   ```bash
   git add -A
   git commit -m "refactor: แยก DB ออกจาก UI (service/adapter layer)"
   git push origin main
   ```
3. **ตั้ง env vars บน Vercel** — [vercel.com](https://vercel.com) → โปรเจกต์ → **Settings → Environment Variables** → เพิ่ม (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_HIDDEN_ALLOWED_EMAILS`, `USAGE_ALLOWED_EMAILS`.
4. **Deploy** — push ก็ขึ้นอัตโนมัติ (รอ 1–2 นาที); ไม่ auto → กด **Redeploy**.
5. **Verify** — login Google → กลับหน้าถูกต้อง (ไม่ติด localhost) → กดซ่อนงาน → งานหายทั้งคอมทั้งมือถือ (cross-device ✅).

> 💡 **บทเรียนที่เคยเจอ:** Login ขึ้น `http://localhost:3000/?code=...` → **Site URL / Redirect URLs ตั้งไม่ถูก** (default localhost). Production หน้า auth ไม่ทำงาน → ลืมตั้ง env แล้วต้อง Redeploy.

---

## วิธีทดสอบ hidden-tasks (global)

1. ล็อกอิน Google จากคอม (ปุ่ม "เข้าสู่ระบบ" ที่ nav) ด้วยบัญชี **owner** (`theerawat.numtang@gmail.com`)
2. กดซ่อนงาน → เลือกเหตุผล → ยืนยัน → งานหาย
3. เปิดเว็บเดียวกันบนมือถือ (ไม่ต้อง login) → งานนั้นต้องไม่แสดง (global ✅)
4. นำงานกลับมา → คอมเห็นงานกลับมา (realtime / เมื่อโฟกัสแท็บ)
5. ผู้เข้าชมคนอื่น (ไม่ใช่ owner) อ่านเห็นชุดซ่อน**เหมือนกัน** แต่**กดซ่อน/แกะไม่ได้** (RLS บังคับ)

---

## ตาราง `hidden_tasks` (schema ปัจจุบัน — global)

| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| `id` | uuid PK | default gen_random_uuid() |
| `user_id` | uuid nullable | เดิมซ่อนไว้; ตอนนี้ไม่ผูก auth (global) — เก็บไว้ให้ row เก่ารอด |
| `task_key` | text | course\|title\|due |
| `course` | text | |
| `title` | text | |
| `due` | text nullable | |
| `reason` | text | wrong-due / already-submitted / cancelled / other |
| `custom_reason` | text nullable | เมื่อ reason = other |
| `hidden_at` | timestamptz | default now() |

- Unique: **`(task_key)`** → re-hide เป็น idempotent upsert (global)
- RLS: **SELECT เปิดทุกคน**; **INSERT/UPDATE/DELETE เฉพาะ owner** ผ่าน `is_hidden_tasks_owner()` (email allow-list)
- Realtime publication เปิดอยู่ → ซิงก์ข้ามอุปกรณ์

---

## มีคำถาม?

- Supabase free tier / บัญชี → [supabase.com/docs](https://supabase.com/docs)
- Cloudflare D1 → [developers.cloudflare.com/d1](https://developers.cloudflare.com/d1/)
- โครงสร้างโปรเจกต์ → [Next.js App Router docs](https://nextjs.org/docs/app)