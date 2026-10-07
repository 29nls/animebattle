# Runbook Operasional — Rencana

Folder ini adalah tempat runbook operasional yang **diminta oleh AC-30** (lihat [PRD §35.2](../PRD.md#352-non-fungsional)). Runbook ditulis pada Sprint 4 (hardening) dan wajib lengkap sebelum rilis publik — bukan setelah insiden pertama.

Status: **belum ditulis** (menunggu implementasi). Halaman ini menetapkan isi wajib setiap runbook agar tidak menjadi formalitas.

## Daftar runbook

| File | Dipicu oleh | Isi wajib |
|---|---|---|
| `ingestion.md` | Job `failed`/`partial`, error rate sumber > 10% selama 3 run, backlog job > 500 | Cara membaca counters job; membedakan retry-able vs fatal; cara resume dari `cursor`; cara re-parse dari `ingestion_raw_pages` tanpa fetch ulang; cara menaikkan `parser_version`; cara menonaktifkan sumber; kapan harus berhenti mencoba dan mengimpor manual |
| `conflict-review.md` | `character_source_conflicts.status = 'open'` | Prioritas sumber (kelas 1–5); kapan `keep_a`/`keep_b` sah; kapan `keep_both` (dipecah per form) lebih benar; kapan menandai `unresolved` dan mengapa itu lebih baik daripada menebak; cara mencatat alasan di `resolution` |
| `merge.md` | `merge_candidates` skor 0,70–0,90 | Pemeriksaan sebelum merge (verse sama? era sama? sumber sama?); urutan pemindahan form/alias/feat; pembuatan `slug_redirects`; cara membatalkan merge yang salah |
| `takedown.md` | Laporan hak cipta masuk | Timeline SLA 24 jam → 7 hari kerja ([PRD §30.3](../PRD.md#303-proses-takedown)); cara menyembunyikan artwork tanpa menghapus data karakter (LP-2); cara menonaktifkan sumber dan menghapus excerpt; template balasan; cara menambah domain ke deny-list |
| `rollback.md` | Data ingestion yang buruk sudah masuk produksi | Cara memakai `audit_logs` (`before`/`after`) untuk membatalkan perubahan per-entitas; batas aman rollback; kapan restore dari backup lebih tepat; cara memverifikasi hasil rollback terhadap `statistics.status` |
| `incident.md` | API 5xx > 0,5%, p95 simulasi melewati target, kebocoran kunci | Triase; cara menentukan apakah masalah di web/DB/worker; cara menonaktifkan ingestion sementara; cara merotasi kunci tanpa downtime |

## Aturan penulisan runbook

1. **Setiap langkah harus dapat dijalankan oleh orang yang tidak menulis sistemnya.** Tanpa "hubungi penulis kode" sebagai langkah.
2. **Setiap perintah harus lengkap**, termasuk cara memverifikasi bahwa perintah itu berhasil (bukan hanya "jalankan X").
3. **Sertakan jalur gagal**: apa yang dilakukan bila langkah 3 tidak memperbaiki keadaan.
4. **Sebutkan apa yang TIDAK boleh dilakukan** (mis. menghapus `statistics` lama, menjalankan `full sync` saat insiden, menimpa konflik secara massal).
5. **Uji sekali di staging** sebelum dianggap selesai; catat tanggal pengujian di kepala file.
