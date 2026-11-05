-- 0005 — Simpan keluaran engine utuh untuk cache battle.
--
-- `battle_results` menyimpan kolom yang dibutuhkan untuk query dan agregasi,
-- tetapi tidak seluruh keluaran engine: `weighted_score`, `dominance`,
-- `coverage`, `ability_outcomes`, dan `disclaimer` tidak punya kolom. Halaman
-- hasil menampilkan semuanya, jadi membaca cache lalu merekonstruksi objek dari
-- kolom akan mengisi bidang-bidang itu dengan nol/kosong — angka palsu yang
-- terlihat seperti hasil hitung.
--
-- Kolom ini menyimpan `BattleResult` apa adanya. Baris lama (NULL) diperlakukan
-- sebagai cache miss oleh `readCachedBattle()`, sehingga tidak ada halaman yang
-- menyajikan hasil rekonstruksi.

alter table battle_results
  add column if not exists result_payload jsonb;

comment on column battle_results.result_payload is
  'Keluaran engine utuh (BattleResult). NULL = baris lama sebelum 0005; pembaca wajib menganggapnya cache miss.';
