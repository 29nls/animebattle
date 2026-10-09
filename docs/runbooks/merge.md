# Runbook — Merge Karakter Duplikat

**Status:** aktif. Seluruh langkah SQL diuji di PGlite lokal dengan
`docs/schema.sql` + `docs/seed.sql` (2026-10-09); **belum** pernah dijalankan pada
instance Supabase produksi.

Dipicu oleh:

- `merge_candidates` berstatus `pending` dengan skor 0,70–0,90 (antrian review
  manusia — PRD §21.1; skor ≥ 0,90 digabung otomatis oleh pipeline, < 0,70 jadi
  entitas baru);
- laporan duplikat dari kurator (dua karakter ternyata orang yang sama);
- setelah [conflict-review.md](conflict-review.md) menemukan dua entitas yang
  selama ini memperebutkan metrik yang sama.

**Baca dulu — keadaan jujur antarmuka hari ini:** belum ada kode yang menjalankan
merge (tabel `merge_candidates` dan `slug_redirects` sudah ada, pembacaan sudah
diuji, tetapi tidak ada tombol maupun fungsi merge). Prosedur ini karena itu
dieksekusi lewat SQL admin. Aturan yang harus dipatuhi (PRD §21.1, DR-1…DR-3):
merge **tidak pernah** menghapus form/statistik, **tidak pernah** menggabungkan
dua `verse` berbeda tanpa persetujuan admin, dan **selalu** membuat redirect 301.

## 1. Membaca keadaan dalam 30 detik

```sql
select mc.id, mc.similarity_score, mc.signals, mc.status,
       ca.slug as slug_a, cb.slug as slug_b,
       va.slug as verse_a, vb.slug as verse_b,
       (select count(*) from character_versions where character_id = mc.character_a_id) as form_a,
       (select count(*) from character_versions where character_id = mc.character_b_id) as form_b
  from merge_candidates mc
  join characters ca on ca.id = mc.character_a_id
  join characters cb on cb.id = mc.character_b_id
  join verses va on va.id = ca.verse_id
  join verses vb on vb.id = cb.verse_id
 where mc.status = 'pending'
 order by mc.similarity_score desc;
```

Antrian `pending` dengan skor 0,70–0,90 = pekerjaan review. Skor ≥ 0,90 tidak
seharusnya berada di antrian (sudah merge otomatis); bila ada, itu sinyal merge
otomatis tidak berjalan — bukan alasan untuk mengkliknya membabi buta.

## 2. Pemeriksaan sebelum merge (wajib, semuanya)

Jawab empat pertanyaan ini dulu. Satu saja berbeda → **jangan merge.**

| # | Pertanyaan | SQL pemeriksa | Bila berbeda |
|---|---|---|---|
| 1 | **Verse sama?** | `select slug from verses where id in (select verse_id from characters where id in ('<a>','<b>'));` | **Berhenti.** DR-2: merge lintas verse butuh persetujuan admin tertulis (mereka bisa karakter beda universe dengan nama sama, mis. Sakura). |
| 2 | **Era/kelompok sama?** | Bandingkan `character_versions.era` dan `form_order` kedua karakter | Berbeda = kemungkinan besar ini 1 karakter, 2 era → **bukan merge**, tapi tetapkan salah satunya sebagai `variant_of` yang lain |
| 3 | **Sumber sama?** | `select source_id, role from character_sources where character_id in ('<a>','<b>');` | Berbeda sumber = dua data set independen; gabungkan hanya bila pemeriksaan nama+fingerprint juga cocok |
| 4 | **Nama & fingerprint cocok?** | `select name, fp_key, (select string_agg(alias, ' | ') from character_aliases where character_id = c.id) from characters c where id in ('<a>','<b>');` | `fp_key` berbeda → keduanya dihitung duplikat oleh §21.2 hanya bila skor tinggi karena alasan lain; verifikasi manual sebelum lanjut |

Kesamaan skor semata **tidak pernah** cukup: skor 0,70–0,90 memang rentang
"mungkin duplikat", dan antrian ini dibuat justru karena otomasi dilarang
memutuskan di situ.

## 3. Urutan merge (satu transaksi)

Anak-anak karakter: `character_versions` (dengan `statistics`, `character_traits`,
`equipment`, `character_abilities`, `character_resistances`, `feats` di dalamnya),
`character_aliases`, `character_sources`, `character_source_conflicts`,
`data_reports`. Urutannya penting karena tiga batas unik: `unique (character_id,
slug)` pada form, `unique (character_id, alias)` pada alias, dan
`unique (character_id, source_id, role)` pada sumber — plus indeks unik
"satu form default per karakter".

Simpan dulu salinan untuk pembatalan (lihat §5):

```sql
create table merge_undo_<yyyymmdd> as
select 'characters' as tbl, id::text as pk, row_to_json(c) as snapshot
  from characters c where id in ('<a>','<b>')
union all
select 'character_versions', id::text, row_to_json(v)
  from character_versions v where character_id in ('<a>','<b>')
union all
select 'character_aliases', id::text, row_to_json(x)
  from character_aliases x where character_id in ('<a>','<b>')
union all
select 'character_sources', id::text, row_to_json(s)
  from character_sources s where character_id in ('<a>','<b>')
union all
select 'character_source_conflicts', id::text, row_to_json(k)
  from character_source_conflicts k where character_id in ('<a>','<b>')
union all
select 'data_reports', id::text, row_to_json(r)
  from data_reports r where character_id in ('<a>','<b>')
union all
-- kandidat merge ikut disalin: baris pasangan (:target, :loser) ter-cascade
-- saat :loser dihapus pada langkah 9 — tanpa salinan ini, pembatalan §5 tidak
-- dapat menghidupkannya kembali
select 'merge_candidates', id::text, row_to_json(m)
  from merge_candidates m
 where character_a_id in ('<a>','<b>') or character_b_id in ('<a>','<b>');
```

Kolom `snapshot` menyimpan `row_to_json` lengkap (termasuk `id` asli), sehingga
pembatalan di §5 dapat mengembalikan baris ke tempatnya persis — termasuk
`character_aliases.alias_norm` yang **tidak** ikut ditulis ulang (kolom generated).

Kemudian jalankan seluruh blok sebagai satu transaksi (`begin;` … `commit;`):

```sql
begin;
-- 0. pilih pemenang: biasanya entitas dengan form/sumber lebih lengkap
--    :target = karakter yang dipertahankan, :loser = yang digabung masuk

-- 1. pindahkan FORM lebih dulu (statistik/ability/feat ikut otomatis karena
--    menggantung di character_versions)
update character_versions set is_default = false
 where character_id = :loser and is_default;      -- indeks: satu default per karakter

update character_versions v set slug = v.slug || '-' || left(:loser::text, 8)
 where v.character_id = :loser
   and exists (select 1 from character_versions t
                where t.character_id = :target and t.slug = v.slug);  -- unique(character_id, slug)

update character_versions set character_id = :target where character_id = :loser;

-- 2. ALIAS: pindahkan yang belum ada di target, buang duplikatnya
insert into character_aliases (character_id, alias, script, is_primary, source_id)
select :target, a.alias, a.script, false, a.source_id
  from character_aliases a where a.character_id = :loser
on conflict (character_id, alias) do nothing;
delete from character_aliases where character_id = :loser;

-- 3. SUMBER atribusi: sama — duplikat tidak menambah informasi
insert into character_sources (character_id, source_id, source_url, role, notes, imported_at)
select :target, s.source_id, s.source_url, s.role, s.notes, s.imported_at
  from character_sources s where s.character_id = :loser
on conflict (character_id, source_id, role) do nothing;
delete from character_sources where character_id = :loser;

-- 4. ANTRIAN KONFLIK & LAPORAN ikut berpindah agar review tetap lengkap
update character_source_conflicts set character_id = :target where character_id = :loser;
update data_reports                 set character_id = :target where character_id = :loser;

-- 5. redirect 301 dari slug lama (DR-3); bila sudah ada, ikat ke target
insert into slug_redirects (old_slug, entity_type, new_slug)
values (:loser_slug, 'character', :target_slug)
on conflict (old_slug) do update set new_slug = excluded.new_slug,
                                     entity_type = excluded.entity_type;

-- 6. antrian merge lain yang menunjuk :loser harus ikut berpindah.
--    Kandidat yang sedang diproses (id = :candidate_id) DIKECUALIKAN: pasangannya
--    memang memuat :loser, dan ia ditandai pada langkah 7.
delete from merge_candidates m
 where m.id <> :candidate_id
   and (m.character_a_id = :loser or m.character_b_id = :loser)
   and (:target in (m.character_a_id, m.character_b_id));   -- akan jadi duplikat pasangan

--    `least`/`greatest` menjaga character_a_id < character_b_id DI DALAM statement
--    yang sama: check merge_candidates_ordered berlaku langsung per baris, jadi
--    urutan yang dibetulkan lewat 'swap' terpisah tidak akan pernah sempat
--    berjalan — barisnya sudah ditolak sebelum swap dijalankan.
update merge_candidates
   set character_a_id = pair.new_a,
       character_b_id = pair.new_b
  from (select id,
               least(case when character_a_id = :loser then :target else character_a_id end,
                     case when character_b_id = :loser then :target else character_b_id end) as new_a,
               greatest(case when character_a_id = :loser then :target else character_a_id end,
                        case when character_b_id = :loser then :target else character_b_id end) as new_b
          from merge_candidates
         where id <> :candidate_id
           and (character_a_id = :loser or character_b_id = :loser)) pair
 where merge_candidates.id = pair.id;

-- 7. tandai kandidat ini selesai. HARUS sebelum langkah 9: pasangan
--    (target, loser) tetap menunjuk :loser, dan `on delete cascade` FK
--    merge_candidates ikut menghapus baris ini begitu :loser dihapus —
--    jejak permanennya ada di audit_logs (langkah 8) + tabel undo (§5)
update merge_candidates set status = 'merged', resolved_by = :actor, resolved_at = now()
 where id = :candidate_id;

-- 8. jejak audit (hari ini ditulis manual; tidak ada penulis kode — lihat §6)
insert into audit_logs (action, entity_type, entity_id, before, after)
values ('merge_characters', 'character', :loser::text,
        jsonb_build_object('slug', :loser_slug),
        jsonb_build_object('slug', :target_slug, 'candidate_id', :candidate_id,
                           'undo_table', 'merge_undo_<yyyymmdd>'));

-- 9. karakter kalah dikosongkan — anak-anaknya sudah dipindah semua
delete from characters where id = :loser;
commit;
```

Mengapa `delete` di baris 9 bukan pelanggaran DR-1: yang dihapus adalah baris
**karakter** kosong; seluruh form, statistik, alias, dan feat sudah berpindah ke
target pada langkah 1–3. DR-1 melarang menghapus form/stat — dan memang tidak ada
yang dihapus.

## 4. Jalur gagal

| Langkah | Gejala | Yang dikerjakan |
|---|---|---|
| Langkah 1 menabrak `unique (character_id, slug)` | `duplicate key value violates constraint "character_versions_character_id_slug_key"` | Pembenaran slug di langkah 1 (blok `update ... suffix`) terlewat atau id salah. Perbaiki, jalankan **ulang seluruh transaksi dari awal** (karena gagal di tengah = rollback penuh) |
| Langkah 1 menabrak `idx_versions_single_default` | `duplicate key value violates constraint "idx_versions_single_default"` | Blok `is_default = false` pada :loser terlewat; jalankan ulang transaksi |
| Langkah 6 menabrak `uq_merge_pair` | Pasangan `(target, X)` **dan** `(loser, X)` sama-sama ada di `merge_candidates`; memindahkan yang kedua ke `target` menabrak pasangan pertama | Hapus salah satu pasangan duplikat — `delete from merge_candidates where character_a_id = '<target>' and character_b_id = '<X>';` atau yang menunjuk `:loser` — lalu jalankan ulang transaksi |
| Langkah 8/9 gagal | Semua kembali ke kondisi awal (transaksi) | Perbaiki penyebab, ulangi dari awal. **Tidak ada** kondisi "form sudah terlanjur pindah tapi redirect belum ada" — itu justru alasan semua langkah dibungkus satu transaksi |
| Ternyata merge salah setelah `commit` | Data sudah menyatu | Ikuti §5 — jangan mengedit baris satu per satu tanpa salinan |
| Skor 0,95 muncul di antrian padahal seharusnya auto-merge | Pipeline/aturan §21.2 bermasalah | Jangan merge manual untuk menutupinya; perbaiki detektor. Merge manual tidak memperbaiki penyebabnya |

## 5. Membatalkan merge yang salah

Batalkan **selama** tabel `merge_undo_<yyyymmdd>` masih ada — tabel itu tidak
memiliki pembersih otomatis, jadi hapus hanya setelah Anda menetapkan periode
retensi sendiri (disarankan ≥ 30 hari). Karena `id` baris anak dipertahankan,
statistik/ability/feat yang menggantung di `character_version_id` ikut kembali
otomatis begitu formnya kembali; tidak ada satu pun di antaranya yang perlu
Disentuh.

```sql
begin;
-- 1. karakter kalah dihidupkan lagi dari salinan (json_populate_record mengisi
--    seluruh kolom characters — tabel itu tanpa kolom generated)
insert into characters
select (json_populate_record(null::characters, s.snapshot)).*
  from merge_undo_<yyyymmdd> s
 where s.tbl = 'characters'
   and not exists (select 1 from characters c where c.id::text = s.pk);

-- 2. form kembali ke karakternya masing-masing MENURUT SNAPSHOT (tabel undo
--    memuat baris KEDUA karakter; mengembalikan semuanya ke :loser akan ikut
--    menarik form milik target — jangan). sufiks slug dibalikkan; default dipulihkan
update character_versions v
   set character_id = (s.snapshot->>'character_id')::uuid,
       slug = case when right(v.slug, 9) = '-' || left('<loser-uuid>'::text, 8)
                   then left(v.slug, length(v.slug) - 9) else v.slug end,
       is_default = coalesce((s.snapshot->>'is_default')::boolean, v.is_default)
  from merge_undo_<yyyymmdd> s
 where s.tbl = 'character_versions' and s.pk = v.id::text
   and v.character_id = (select c.id from characters c where c.slug = '<target-slug>');

-- 3. alias & atribusi sumber yang hilang dipulihkan dari salinan
--    (alias_norm tidak disertakan: kolom generated, dihitung ulang otomatis)
insert into character_aliases (id, character_id, alias, script, is_primary, source_id, created_at)
select (s.snapshot->>'id')::uuid,
       (select c.id from characters c where c.slug = '<loser-slug>'),
       s.snapshot->>'alias', (s.snapshot->>'script')::alias_script_t,
       (s.snapshot->>'is_primary')::boolean, (s.snapshot->>'source_id')::uuid,
       (s.snapshot->>'created_at')::timestamptz
  from merge_undo_<yyyymmdd> s
 where s.tbl = 'character_aliases'
   and not exists (select 1 from character_aliases a where a.id::text = s.pk);

insert into character_sources (id, character_id, source_id, source_url, role, notes, imported_at)
select (s.snapshot->>'id')::uuid,
       (select c.id from characters c where c.slug = '<loser-slug>'),
       (s.snapshot->>'source_id')::uuid, s.snapshot->>'source_url',
       (s.snapshot->>'role')::source_role_t, s.snapshot->>'notes',
       (s.snapshot->>'imported_at')::timestamptz
  from merge_undo_<yyyymmdd> s
 where s.tbl = 'character_sources'
   and not exists (select 1 from character_sources cs where cs.id::text = s.pk);

-- 3b. baris yang barusan DIPINDAHKAN merge ke target dihapus lagi dari target,
--     supaya alias/atribusi tidak tercatat di dua karakter (duplikasi dua arah).
--     Pembedanya aman: baris hasil pindahan punya id BARU (tidak ada di tabel
--     undo), sementara baris milik target asli ikut tersnapshot — jadi tidak
--     mungkin salah menghapus milik target.
delete from character_aliases x
 where x.character_id = (select id from characters where slug = '<target-slug>')
   and x.id::text not in (select pk from merge_undo_<yyyymmdd> where tbl = 'character_aliases')
   and exists (select 1 from merge_undo_<yyyymmdd> s
                where s.tbl = 'character_aliases'
                  and (s.snapshot->>'character_id') = '<loser-uuid>'
                  and (s.snapshot->>'alias') = x.alias);

delete from character_sources x
 where x.character_id = (select id from characters where slug = '<target-slug>')
   and x.id::text not in (select pk from merge_undo_<yyyymmdd> where tbl = 'character_sources')
   and exists (select 1 from merge_undo_<yyyymmdd> s
                where s.tbl = 'character_sources'
                  and (s.snapshot->>'character_id') = '<loser-uuid>'
                  and (s.snapshot->>'source_id')::uuid = x.source_id
                  and (s.snapshot->>'role')::source_role_t = x.role);

-- 4. konflik & laporan kembali ke pemiliknya MENURUT SNAPSHOT (alasan yang sama
--    dengan langkah 2: baris milik target ikut tersimpan di tabel undo)
update character_source_conflicts k
   set character_id = (s.snapshot->>'character_id')::uuid
  from merge_undo_<yyyymmdd> s
 where s.tbl = 'character_source_conflicts' and s.pk = k.id::text;
update data_reports r
   set character_id = (s.snapshot->>'character_id')::uuid
  from merge_undo_<yyyymmdd> s
 where s.tbl = 'data_reports' and s.pk = r.id::text;

-- 5. redirect dibuang; antrian merge dipulihkan dari salinan — baris pasangan
--    (target, loser) ikut ter-cascade saat :loser dihapus, jadi bisa jadi perlu
--    dihidupkan lagi, sementara baris lain yang selamat cukup dikembalikan
--    pasangan & statusnya
delete from slug_redirects where old_slug = '<loser-slug>' and new_slug = '<target-slug>';

insert into merge_candidates
  (id, character_a_id, character_b_id, similarity_score, signals, status, created_at)
select (s.snapshot->>'id')::uuid,
       (s.snapshot->>'character_a_id')::uuid,
       (s.snapshot->>'character_b_id')::uuid,
       (s.snapshot->>'similarity_score')::numeric,
       (s.snapshot->>'signals')::jsonb,
       'pending', (s.snapshot->>'created_at')::timestamptz
  from merge_undo_<yyyymmdd> s
 where s.tbl = 'merge_candidates'
   and not exists (select 1 from merge_candidates m where m.id::text = s.pk);

update merge_candidates m
   set character_a_id = (s.snapshot->>'character_a_id')::uuid,
       character_b_id = (s.snapshot->>'character_b_id')::uuid,
       status = 'pending', resolved_by = null, resolved_at = null
  from merge_undo_<yyyymmdd> s
 where s.tbl = 'merge_candidates' and s.pk = m.id::text;

-- 6. catat pembatalan
insert into audit_logs (action, entity_type, entity_id, before, after)
values ('merge_rollback', 'character', '<loser-uuid>',
        jsonb_build_object('candidate_id', '<candidate-id>'),
        jsonb_build_object('reason', '<alasan>', 'undo_table', 'merge_undo_<yyyymmdd>'));
commit;
```

Yang **tidak** dapat dipulihkan tanpa salinan: alias atau baris sumber yang
ditolak `on conflict do nothing` saat langkah 2–3 (duplikat memang sengaja
dibuang) — karena itu langkah pertama runbook ini selalu membuat tabel
`merge_undo_*`. Bila salinan itu sudah tidak ada dan kehilangan terasa fatal,
jalur pemulihan terakhir adalah restore backup database, lihat
[rollback.md](rollback.md) §5.

## 6. Yang TIDAK boleh dilakukan

1. **Jangan merge lintas `verse`.** DR-2; nama sama di dua universe bukan duplikat.
2. **Jangan menghapus form atau baris `statistics` saat merge.** Itu inti DR-1.
3. **Jangan merge tanpa `slug_redirects`.** DR-3 — URL lama yang mati merusak
   permalink yang sudah dibagikan (dan sitemap).
4. **Jangan menyetujui seluruh antrian berdasarkan skor.** 0,70–0,90 memang
   dirancang untuk ditinjau manusia.
5. **Jangan menjalankan langkah 1–9 sebagai kumpulan perintah terpisah tanpa
   transaksi.** Kondisi setengah-jalan (form pindah, karakter belum dihapus,
   redirect belum ada) membuat data terlihat duplikat di seluruh situs.

## 7. Batas yang diketahui (jujur)

1. **Belum ada tombol merge.** Prosedur ini SQL; UI side-by-side diff yang disebut
   PRD §21.1 belum dibangun.
2. **Belum ada detektor duplikat yang mengisi `merge_candidates`** — tabelnya
   kosong sampai fingerprint §21.2 dijalankan pada data produksi (dan auto-merge
   ≥ 0,90 diuji end-to-end).
3. **`audit_logs` belum ditulis oleh kode mana pun** (lihat [rollback.md](rollback.md) §8).
   Langkah 8 di atas adalah tulisan manual yang menjembatani celah itu.
4. **Tidak ada `users` nyata** sebelum Supabase Auth, jadi `resolved_by` diisi uuid
   operator, bukan akun terotentikasi.

## 8. Verifikasi setelah tindakan

```sql
-- 1. karakter kalah benar-benar hilang, target masih ada
select slug from characters where id in (:target, :loser);

-- 2. tidak ada yatim: seluruh form kini milik target
select count(*) from character_versions where character_id = :target;   -- = form_a + form_b

-- 3. satu form default saja
select count(*) from character_versions where character_id = :target and is_default and deleted_at is null;  -- = 1

-- 4. redirect hidup dan menunjuk tempat yang benar
select * from slug_redirects where old_slug = :loser_slug;              -- new_slug = :target_slug

-- 5. jejak merge — DUA hasil yang keduanya benar:
--    a. baris kandidat pasangan (target, loser) ikut ter-cascade saat :loser
--       dihapus (on delete cascade): HARUS 0 baris, bukan berstatus 'merged'
select count(*) from merge_candidates where id = :candidate_id;              -- → 0
--    b. jejak permanennya di audit_logs (langkah 8)
select after->>'candidate_id' from audit_logs
 where action = 'merge_characters' and entity_id = :loser::text;             -- → 1 baris

-- 6. kandidat lain yang menunjuk :loser selamat (sudah dipindah ke :target)
--    dan tidak ada baris merge_candidates yang menyentuh id yang sudah dihapus
select count(*) from merge_candidates m
 where not exists (select 1 from characters c where c.id = m.character_a_id)
    or not exists (select 1 from characters c where c.id = m.character_b_id);
```

Berhasil bila semua query di atas konsisten (khususnya #3 = 1 dan #6 = 0), lalu
buka `/character/<target-slug>` dan `/character/<loser-slug>` — yang kedua harus
diarahkan (301) ke yang pertama, dan statistik/form si kalah tampil di halaman
target.
