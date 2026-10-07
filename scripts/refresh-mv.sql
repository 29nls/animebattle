-- Refresh materialized view TANPA mengunci baca (CONCURRENTLY).
--
-- Kenapa file terpisah: REFRESH ... CONCURRENTLY tidak dapat dijalankan di dalam
-- transaksi, sedangkan fungsi RPC (public.refresh_materialized_views) selalu
-- berjalan dalam transaksi. Karena itu refresh rutin dijalankan lewat file ini
-- dari cron/psql, sementara fungsi RPC tetap tersedia sebagai fallback
-- non-concurrent untuk pemakaian ad-hoc dari admin.
--
-- Wajib: setiap MV harus punya UNIQUE index (sudah disediakan di docs/schema.sql),
-- jika tidak Postgres akan menolak refresh CONCURRENTLY.
--
-- Jadwal yang disarankan: hourly untuk popularity & tier distribution,
-- 6 jam sekali untuk index pencarian.
--
-- Pemakaian:
--   psql "$DATABASE_URL" -f scripts/refresh-mv.sql
--
-- Verifikasi setelah dijalankan:
--   select relname, last_analyze from pg_stat_user_tables where relname like 'mv_%';

\timing on

refresh materialized view concurrently mv_battle_popularity;
refresh materialized view concurrently mv_verse_tier_distribution;
refresh materialized view concurrently mv_character_search;

analyze mv_battle_popularity;
analyze mv_verse_tier_distribution;
analyze mv_character_search;
