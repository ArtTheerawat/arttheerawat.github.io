-- ============================================================================
-- Theedeck — LIVE FIX for dashboard "permission denied for table trades"
-- (42501, hint: GRANT SELECT ON public.trades TO authenticated;)
--
-- Why: @supabase/ssr's createBrowserClient authenticates the browser session
-- as an ANONYMOUS SUPABASE USER → role = "authenticated", even when the user
-- is NOT logged in via Google. migration 0006 only granted SELECT to `anon` and
-- `service_role`, so the dashboard got 42501 on trades/signals/trading_daily.
--
-- Paste ALL of this into Supabase → SQL Editor → Run. Idempotent, safe to run
-- more than once.
-- ============================================================================

-- 1) Make the dashboard read tables accessible to BOTH anonymous roles used by
--    the browser client (anon for real unauth requests, authenticated for the
--    @supabase/ssr anonymous-user sessions). 
grant select on public.trades         to anon, authenticated;
grant select on public.signals        to anon, authenticated;
grant select on public.trading_daily  to anon, authenticated;

-- 2) service_role needs full CRUD (upsert already works; add DELETE for cleanup
--    of any test/probe rows left behind by the sync tooling).
grant select, insert, update, delete
  on public.trades, public.signals, public.trading_daily,
     public.sync_state, public.heartbeat, public.system_logs
  to service_role;

-- 3) Remove any leftover probe/test rows (idempotent — no-op if already gone).
delete from public.trades where ticket = '__test_sync__';
delete from public.trades where ticket like '__probe%';
delete from public.trades where ticket like '__t%';

-- ============================================================================
-- Veriification (copy & run after the block above):
-- ============================================================================
-- select has_table_privilege('authenticated','public.trades','select') as auth_can_select,
--        has_table_privilege('anon',         'public.trades','select') as anon_can_select,
--        has_table_privilege('service_role', 'public.trades','delete') as svc_can_delete;
-- select count(*) as leftover_probes from public.trades where ticket like '__%';