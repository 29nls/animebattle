# Runbook Operasional

Folder ini adalah tempat runbook operasional yang **diminta oleh AC-30** (lihat [PRD §35.2](../PRD.md#352-non-fungsional)). Wajib lengkap sebelum rilis publik — bukan setelah insiden pertama.

Status (diperbarui **2026-10-09**): **seluruh enam runbook ditulis** — [`ingestion.md`](ingestion.md) menyertai implementasi pipeline (Sprint 2), lima lainnya (conflict-review, merge, takedown, rollback, incident) selesai di Sprint 4. Langkah SQL kelima runbook itu diuji langkah demi langkah di PGlite lokal dengan `docs/schema.sql` + `docs/seed.sql`: **74 pemeriksaan lulus**, termasuk jalur gagal yang diklaim tiap runbook (constraint menolak, trigger, update 0 baris); pemeriksaan HTTP `incident.md` diverifikasi terhadap rute dev yang berjalan + integration test `tests/security/`. Kepala tiap file mencantumkan tanggal pengujian itu. Kekhawatiran “runbook untuk fitur yang belum ada = fiksi” dijawab dengan seksi **keadaan jujur antarmuka hari ini** di tiap runbook: prosedur memakai SQL admin bila UI-nya memang belum ada, dan bagian **Batas yang diketahui (jujur)** mencantumkan celahnya (detektor konflik AC-15, tombol merge, penyimpanan formulir takedown, penulis `audit_logs` — semuanya memang belum ada). Tabel di bawah tetap menetapkan isi wajib setiap runbook agar tidak menjadi formalitas. Satu runbook sudah dijalankan di instance Supabase produksi: [`ingestion.md`](ingestion.md) (2026-10-10 — impor dataset terkelola lewat jalur panel → worker cron → 73 baris kanonik, re-run `created = 0`, halaman publik dirender dari data itu); lima lainnya masih menunggu staging/produksi, dan itu tetap langkah wajib sebelum rilis publik.

## Daftar runbook

| File | Status | Dipicu oleh | Isi wajib |
|---|---|---|---|
| [`ingestion.md`](ingestion.md) | **Ditulis** (uji produksi 2026-10-10) | Job `failed`/`partial`, error rate sumber > 10% selama 3 run, backlog job > 500 | Cara membaca counters job; membedakan retry-able vs terminal; cara re-parse dari `ingestion_raw_pages` tanpa fetch ulang; triase per `error_type`; batas yang diketahui (adapter crawling, cache robots, limiter per proses) |
| [`conflict-review.md`](conflict-review.md) | **Ditulis** (uji 2026-10-09) | `character_source_conflicts.status = 'open'` | Prioritas sumber (kelas 1–5); kapan `keep_a`/`keep_b` sah; kapan `keep_both` (dipecah per form) lebih benar; kapan menandai `unresolved` dan mengapa itu lebih baik daripada menebak; cara mencatat alasan di `resolution` |
| [`merge.md`](merge.md) | **Ditulis** (uji 2026-10-09) | `merge_candidates` skor 0,70–0,90 | Pemeriksaan sebelum merge (verse sama? era sama? sumber sama?); urutan pemindahan form/alias/feat; pembuatan `slug_redirects`; cara membatalkan merge yang salah |
| [`takedown.md`](takedown.md) | **Ditulis** (uji 2026-10-09) | Laporan hak cipta masuk | Timeline SLA 24 jam → 7 hari kerja ([PRD §30.3](../PRD.md#303-proses-takedown)); cara menyembunyikan artwork tanpa menghapus data karakter (LP-2); cara menonaktifkan sumber dan menghapus excerpt; template balasan; cara menambah domain ke deny-list |
| [`rollback.md`](rollback.md) | **Ditulis** (uji 2026-10-09) | Data ingestion yang buruk sudah masuk produksi | Cara memakai `audit_logs` (`before`/`after`) untuk membatalkan perubahan per-entitas; batas aman rollback; kapan restore dari backup lebih tepat; cara memverifikasi hasil rollback terhadap `statistics.status` |
| [`incident.md`](incident.md) | **Ditulis** (uji 2026-10-09) | API 5xx > 0,5%, p95 simulasi melewati target, kebocoran kunci | Triase; cara menentukan apakah masalah di web/DB/worker; cara menonaktifkan ingestion sementara; cara merotasi kunci tanpa downtime |

## Aturan penulisan runbook

1. **Setiap langkah harus dapat dijalankan oleh orang yang tidak menulis sistemnya.** Tanpa "hubungi penulis kode" sebagai langkah.
2. **Setiap perintah harus lengkap**, termasuk cara memverifikasi bahwa perintah itu berhasil (bukan hanya "jalankan X").
3. **Sertakan jalur gagal**: apa yang dilakukan bila langkah 3 tidak memperbaiki keadaan.
4. **Sebutkan apa yang TIDAK boleh dilakukan** (mis. menghapus `statistics` lama, menjalankan `full sync` saat insiden, menimpa konflik secara massal).
5. **Uji sekali di staging** sebelum dianggap selesai; catat tanggal pengujian di kepala file.
