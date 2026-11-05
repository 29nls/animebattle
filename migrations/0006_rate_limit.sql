-- 0006 — Rate limit terdistribusi di PostgreSQL.
--
-- `FixedWindowRateLimiter` di `src/lib/security/rate-limiter.ts` menyimpan
-- hitungan di Map proses. Di deployment multi-instance (Vercel) setiap instance
-- punya Map sendiri, sehingga batas 30 permintaan/menit per pengguna berubah
-- menjadi 30 × jumlah instance — dan AC-26 ("permintaan ke-31 dijawab 429")
-- tidak dapat dijamin.
--
-- Tabel + fungsi di bawah memindahkan hitungan ke satu tempat yang dilihat semua
-- instance. Alternatifnya Upstash/Vercel KV; dipilih Postgres karena tidak
-- menambah kredensial layanan baru dan database sudah menjadi dependensi wajib
-- untuk kedua endpoint yang dibatasi.
--
-- Kunci bucket di-hash di aplikasi (`rateLimitBucket`), jadi IP mentah tidak
-- pernah tersimpan di sini.

create table rate_limit_windows (
  bucket       text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);
create index idx_rate_limit_windows_start on rate_limit_windows (window_start);

alter table rate_limit_windows enable row level security;

-- Tidak ada policy untuk anon/authenticated: tabel ini hanya disentuh lewat
-- fungsi security definer di bawah (dan oleh pemilik schema). Tanpa policy,
-- RLS menolak semua baris bagi role lain — fail-closed.
create policy pol_rate_limit_windows_admin on rate_limit_windows
  for all to authenticated using (is_admin()) with check (is_admin());

-- Grant menyusul definisi policy (sama seperti daftar `app_tables` di
-- docs/schema.sql §18): RLS menentukan baris, grant menentukan apakah role boleh
-- menyentuh objeknya sama sekali. Anon sengaja tidak diberi grant tabel; ia
-- hanya memanggil fungsi security definer di bawah.
grant select, insert, update, delete on table rate_limit_windows to authenticated;

-- Satu langkah atomik: naikkan hitungan jendela lalu laporkan sisa kuota.
--
-- `on conflict do update` membuat dua permintaan bersamaan tidak dapat sama-sama
-- membaca hitungan lama (bentuk race yang membuat batas bocor). Waktu datang
-- sebagai parameter supaya perilakunya dapat diuji tanpa menunggu jam dinding.
create or replace function rate_limit_hit(
  p_bucket text,
  p_window_ms integer,
  p_limit integer,
  p_now timestamptz default now()
)
returns table (allowed boolean, remaining integer, retry_after_ms integer)
language plpgsql
security definer
set search_path = animebattle, public
as $$
declare
  v_start timestamptz;
  v_hits integer;
  v_reset timestamptz;
begin
  if p_window_ms <= 0 or p_limit <= 0 then
    raise exception 'rate_limit_hit: p_window_ms dan p_limit harus > 0';
  end if;

  -- Awal jendela tetap, sejajar `FixedWindowRateLimiter`: jendela tidak bergeser
  -- mengikuti permintaan pertama, sehingga batasnya dapat diprediksi.
  v_start := to_timestamp(
    floor(extract(epoch from p_now) * 1000 / p_window_ms) * p_window_ms / 1000.0
  );
  v_reset := v_start + make_interval(secs => p_window_ms / 1000.0);

  insert into rate_limit_windows (bucket, window_start, hits)
  values (p_bucket, v_start, 1)
  on conflict (bucket, window_start)
    do update set hits = rate_limit_windows.hits + 1
  returning rate_limit_windows.hits into v_hits;

  -- Pembersihan oportunistik (1% permintaan): tabel tidak tumbuh tanpa batas
  -- tanpa perlu job cron terpisah untuk tujuan ini.
  if random() < 0.01 then
    delete from rate_limit_windows where window_start < p_now - interval '1 day';
  end if;

  return query
    select v_hits <= p_limit,
           greatest(p_limit - v_hits, 0),
           case
             when v_hits <= p_limit then 0
             else greatest(1, ceil(extract(epoch from (v_reset - p_now)) * 1000)::integer)
           end;
end;
$$;

grant execute on function rate_limit_hit(text, integer, integer, timestamptz) to anon, authenticated;
