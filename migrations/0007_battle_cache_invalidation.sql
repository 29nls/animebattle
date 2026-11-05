-- 0007: invalidasi cache battle saat data form berubah.
--
-- Kenapa perlu: `battle_results.cached_until` berlaku 7 hari. Tanpa invalidasi,
-- memperbaiki satu statistik (mis. koreksi durability) tetap menyajikan hasil
-- lama sampai seminggu — persis jenis "data benar tetapi halaman salah" yang
-- sulit dilacak. Baris tidak dihapus: `input_hash` lama tetap dapat diaudit,
-- hanya tidak lagi dianggap cache hit (`cached_until = now()`), sehingga
-- permintaan berikutnya menghitung ulang dan menulis baris baru dengan hash
-- yang berbeda (hash memuat statistik).
--
-- Cakupan: perubahan pada `character_versions`, `statistics`,
-- `character_abilities`, `character_resistances`, dan `character_traits` —
-- kelima tabel yang dibaca `battle_dataset`. Perubahan pada karakter/verse
-- (nama, slug) tidak memengaruhi angka, jadi tidak menginvalidasi apa pun.

create or replace function invalidate_battle_cache_for_version(p_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = animebattle, public
as $$
declare
  v_count integer;
begin
  update battle_results r
     set cached_until = now()
   where r.cached_until > now()
     and exists (
       select 1
         from battles b
        where b.id = r.battle_id
          and (b.side_a_version_id = p_version_id or b.side_b_version_id = p_version_id)
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Trigger generik: satu fungsi untuk semua tabel, membaca kolom
-- `character_version_id` dari baris yang berubah.
create or replace function trg_invalidate_battle_cache()
returns trigger
language plpgsql
security definer
set search_path = animebattle, public
as $$
begin
  if tg_op = 'DELETE' then
    perform invalidate_battle_cache_for_version(old.character_version_id);
    return old;
  end if;
  perform invalidate_battle_cache_for_version(new.character_version_id);
  return new;
end;
$$;

create trigger trg_statistics_invalidate_cache
  after insert or update or delete on statistics
  for each row execute function trg_invalidate_battle_cache();

create trigger trg_char_abilities_invalidate_cache
  after insert or update or delete on character_abilities
  for each row execute function trg_invalidate_battle_cache();

create trigger trg_char_resist_invalidate_cache
  after insert or update or delete on character_resistances
  for each row execute function trg_invalidate_battle_cache();

create trigger trg_char_traits_invalidate_cache
  after insert or update or delete on character_traits
  for each row execute function trg_invalidate_battle_cache();

-- `character_versions` sendiri: tier/era/skala dapat berubah tanpa menyentuh
-- tabel statistik, dan `battle_dataset` membaca kolomnya.
create or replace function trg_invalidate_battle_cache_version()
returns trigger
language plpgsql
security definer
set search_path = animebattle, public
as $$
begin
  perform invalidate_battle_cache_for_version(new.id);
  return new;
end;
$$;

create trigger trg_versions_invalidate_cache
  after update on character_versions
  for each row execute function trg_invalidate_battle_cache_version();

-- Grant: trigger berjalan sebagai pemilik tabel (security definer), jadi peran
-- aplikasi tidak butuh akses langsung ke `battle_results`. Fungsi invalidasi
-- tetap tidak diekspos ke `authenticated` — hanya trigger yang memanggilnya.
revoke all on function invalidate_battle_cache_for_version(uuid) from public;
revoke all on function trg_invalidate_battle_cache() from public;
revoke all on function trg_invalidate_battle_cache_version() from public;
