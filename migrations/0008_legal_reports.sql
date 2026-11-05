-- 0008: tiket laporan legal (takedown/privacy).
--
-- Kenapa tabel baru: `data_reports.character_id` wajib dan laporan legal
-- berbasis URL tidak selalu menunjuk satu karakter. Memaksakan laporan ke
-- tabel itu berarti membuat karakter dummy atau kehilangan tiket.
--
-- Tidak ada grant/policy anon: route /api/legal/takedown memvalidasi dan
-- menulis lewat kredensial server. PII hanya dapat dibaca admin.

create table legal_reports (
  id              uuid primary key default gen_random_uuid(),
  ticket_code     text not null unique
                    default ('AB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  kind            text not null default 'takedown'
                    check (kind in ('takedown', 'privacy', 'other')),
  reporter_name   text not null check (char_length(reporter_name) between 2 and 120),
  reporter_email  text not null
                    check (reporter_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  reported_url    text not null
                    check (reported_url ~* '^https?://' and char_length(reported_url) <= 2048),
  description     text not null check (char_length(description) between 20 and 5000),
  good_faith      boolean not null check (good_faith),
  status          report_status_t not null default 'new',
  reviewed_by     uuid references users(id) on delete set null,
  reviewed_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now()
);

create index idx_legal_reports_status on legal_reports (status, created_at desc);

alter table legal_reports enable row level security;

create policy pol_legal_reports_admin on legal_reports
  for all to authenticated using (is_admin()) with check (is_admin());

grant select, insert, update, delete on table animebattle.legal_reports to authenticated;
