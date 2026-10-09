# Runbook Operasional

Folder ini adalah tempat runbook operasional yang **diminta oleh AC-30** (lihat [PRD §35.2](../PRD.md#352-non-fungsional)). Wajib lengkap sebelum rilis publik — bukan setelah insiden pertama.

Status: [`ingestion.md`](ingestion.md) **sudah ditulis** (menyertai implementasi pipeline, Sprint 2). Lima runbook lain masih rencana pada Sprint 4 (hardening), dan ditulis hanya setelah fitur yang dioperasikannya ada — runbook untuk fitur yang belum ada adalah fiksi. Tabel di bawah menetapkan isi wajib setiap runbook agar tidak menjadi formalitas.

## Daftar runbook

| File | Status | Dipicu oleh | Isi wajib |
|---|---|---|---|
| [`ingestion.md`](ingestion.md) | **Ditulis** | Job `failed`/`partial`, error rate sumber > 10% selama 3 run, backlog job > 500 | Cara membaca counters job; membedakan retry-able vs terminal; cara re-parse dari `ingestion_raw_pages` tanpa fetch ulang; triase per `error_type`; batas yang diketahui (adapter crawling, cache robots, limiter per proses) |
| `conflict-review.md` | Rencana (Sprint 4) | `character_source_conflicts.status = 'open'` | Prioritas sumber (kelas 1–5); kapan `keep_a`/`keep_b` sah; kapan `keep_both` (dipecah per form) lebih benar; kapan menandai `unresolved` dan mengapa itu lebih baik daripada menebak; cara mencatat alasan di `resolution` |
| `merge.md` | Rencana (Sprint 4) | `merge_candidates` skor 0,70–0,90 | Pemeriksaan sebelum merge (verse sama? era sama? sumber sama?); urutan pemindahan form/alias/feat; pembuatan `slug_redirects`; cara membatalkan merge yang salah |
| `takedown.md` | Rencana (Sprint 4) | Laporan hak cipta masuk | Timeline SLA 24 jam → 7 hari kerja ([PRD §30.3](../PRD.md#303-proses-takedown)); cara menyembunyikan artwork tanpa menghapus data karakter (LP-2); cara menonaktifkan sumber dan menghapus excerpt; template balasan; cara menambah domain ke deny-list |
| `rollback.md` | Rencana (Sprint 4) | Data ingestion yang buruk sudah masuk produksi | Cara memakai `audit_logs` (`before`/`after`) untuk membatalkan perubahan per-entitas; batas aman rollback; kapan restore dari backup lebih tepat; cara memverifikasi hasil rollback terhadap `statistics.status` |
| `incident.md` | Rencana (Sprint 4) | API 5xx > 0,5%, p95 simulasi melewati target, kebocoran kunci | Triase; cara menentukan apakah masalah di web/DB/worker; cara menonaktifkan ingestion sementara; cara merotasi kunci tanpa downtime |

## Aturan penulisan runbook

1. **Setiap langkah harus dapat dijalankan oleh orang yang tidak menulis sistemnya.** Tanpa "hubungi penulis kode" sebagai langkah.
2. **Setiap perintah harus lengkap**, termasuk cara memverifikasi bahwa perintah itu berhasil (bukan hanya "jalankan X").
3. **Sertakan jalur gagal**: apa yang dilakukan bila langkah 3 tidak memperbaiki keadaan.
4. **Sebutkan apa yang TIDAK boleh dilakukan** (mis. menghapus `statistics` lama, menjalankan `full sync` saat insiden, menimpa konflik secara massal).
5. **Uji sekali di staging** sebelum dianggap selesai; catat tanggal pengujian di kepala file.
