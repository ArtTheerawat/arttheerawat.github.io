-- ============================================================================
-- Theedeck trading data — Supabase migration
-- ----------------------------------------------------------------------------
-- Source of truth for the MT5 trading dashboard. Replaces the data.json served
-- from Google Sheets as the primary store the /trading page reads from.
--
-- Run in Supabase Dashboard → SQL Editor → New query → Run.
--
-- RLS design (kept simple + low-maintenance):
--   * trades / signals / trading_daily = READ-ONLY public (anon can SELECT).
--       The /trading page is a static export (GitHub Pages) and fetches with the
--       browser anon key. Data is the user's own personal trading log — reads
--       are public for convenience; writes are NOT allowed for anon.
--   * All writes happen server-side from the Python sync script using the
--       SERVICE_ROLE key, which bypasses RLS entirely. So we enable RLS on
--       every table but add NO insert/update/delete policies for anon — that
--       alone guarantees anon can never write.
--   * sync_state / heartbeat / system_logs = NOT exposed to anon (no SELECT
--       policy). These are operational tables read only by trusted/side tooling,
--       never by the public static site.
-- ============================================================================

-- 1) trades — one row per MT5 trade ticket (upsert on ticket).
create table if not exists public.trades (
  id            bigint generated always as identity primary key,
  ticket        text unique not null,          -- MT5 order ticket (unique upsert key)
  timestamp     timestamptz,
  type          text,
  symbol        text,
  direction     text,
  volume        double precision,
  entry         double precision,
  sl            double precision,
  tp            double precision,
  exit          double precision,
  profit        double precision,
  swap          double precision,
  commission    double precision,
  net_pnl       double precision,
  status        text,
  signal_reason text,
  strategy      text,
  risk          double precision,
  balance_after double precision,
  notes         text,
  meta          jsonb default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists trades_timestamp_idx on public.trades (timestamp desc);
create index if not exists trades_status_idx on public.trades (status);

-- 2) signals — one row per published trading signal.
create table if not exists public.signals (
  id          bigint generated always as identity primary key,
  signal_key  text unique,                     -- dedupe key (timestamp+symbol run)
  timestamp   timestamptz,
  symbol      text,
  signal      text,
  direction   text,
  confidence  text,
  d1_trend    text,
  h1_trend    text,
  rsi         double precision,
  atr         double precision,
  entry_zone  text,
  sl          double precision,
  tp          double precision,
  status      text,
  notes       text,
  meta        jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists signals_timestamp_idx on public.signals (timestamp desc);

-- 3) trading_daily — aggregate stats per day.
create table if not exists public.trading_daily (
  id            bigint generated always as identity primary key,
  date          date unique not null,
  total_trades  integer,
  wins          integer,
  losses        integer,
  winrate       double precision,
  net_pnl       double precision,
  max_drawdown  double precision,
  avg_rr        double precision,
  balance       double precision,
  equity_peak   double precision,
  equity_low    double precision,
  updated_at    timestamptz not null default now()
);

-- 4) sync_state — per-service incremental-sync watermark.
create table if not exists public.sync_state (
  id             bigint generated always as identity primary key,
  service        text unique not null,
  last_started   timestamptz,
  last_success   timestamptz,
  last_error     text,
  status         text,
  records_synced integer,
  updated_at     timestamptz not null default now()
);

-- 5) heartbeat — dead-man's-switch status per service.
create table if not exists public.heartbeat (
  id           bigint generated always as identity primary key,
  service      text unique not null,
  last_seen    timestamptz,
  last_success timestamptz,
  status       text,
  message      text,
  updated_at   timestamptz not null default now()
);

-- 6) system_logs — error / warning trail for the dashboard.
create table if not exists public.system_logs (
  id         bigint generated always as identity primary key,
  service    text not null,
  level      text not null default 'INFO',
  message    text,
  timestamp  timestamptz not null default now(),
  metadata   jsonb default '{}'::jsonb
);

create index if not exists system_logs_timestamp_idx on public.system_logs (timestamp desc);
create index if not exists system_logs_level_idx on public.system_logs (level);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- trades: anon may SELECT (dashboard reads). No anon write policy anywhere.
alter table public.trades enable row level security;
create policy "trades_select_public" on public.trades
  for select using (true);

-- signals: anon may SELECT.
alter table public.signals enable row level security;
create policy "signals_select_public" on public.signals
  for select using (true);

-- trading_daily: anon may SELECT.
alter table public.trading_daily enable row level security;
create policy "trading_daily_select_public" on public.trading_daily
  for select using (true);

-- sync_state: operational, NOT exposed to anon (no select policy).
alter table public.sync_state enable row level security;

-- heartbeat: operational, NOT exposed to anon.
alter table public.heartbeat enable row level security;

-- system_logs: operational, NOT exposed to anon.
alter table public.system_logs enable row level security;

-- service_role bypasses RLS (server-side writes). Explicit grants so the
-- Python sync script / side tooling are guaranteed read+write access even if
-- the project's default privileges for service_role differ.
grant select, insert, update
  on public.trades, public.signals, public.trading_daily,
     public.sync_state, public.heartbeat, public.system_logs
  to service_role;

-- ============================================================================
-- Verification queries (paste into SQL Editor to confirm):
--   select table_name from information_schema.tables where table_schema='public' order by table_name;
--   select tablename, policyname from pg_policies where schemaname='public' order by tablename;
--   -- expect trades/signals/trading_daily to each have one 'select_public' policy and NO other policies.
-- ============================================================================