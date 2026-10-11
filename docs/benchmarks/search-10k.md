## Benchmark pencarian — dataset sintetis 10.000 karakter

Bentuk dataset: 10.000 karakter, 11.982 form, 3.338 alias, 6.000 statistik, 1.500 ability, 500 resistensi, 20 verse. Seeding 16314 ms.

| Query | p50 | p95 | max | baris | catatan |
| --- | ---: | ---: | ---: | ---: | --- |
| search selektif (nama) |    653.5 ms |    656.3 ms |    661.5 ms | 3 | "gokuto bench" — 3 dari 10.000 baris → 3 baris (total=3) |
| search alias |    587.9 ms |    592.9 ms |    599.1 ms | 3 | "kakarotto" → record kanonik → 3 baris (total=3) |
| search typo |    581.7 ms |    591.2 ms |    597.0 ms | 3 | "kakarotp" → toleransi trigram pada alias → 3 baris (total=3) |
| search prefiks |    561.3 ms |    570.2 ms |    573.1 ms | 3 | "goku" → awalan nama → 3 baris (total=3) |
| search unicode (CJK) |    623.5 ms |    630.5 ms |    632.3 ms | 3 | "ベンチゴクト" → native_name → 3 baris (total=3) |
| search luas |    923.5 ms |    938.7 ms |    947.0 ms | 20 | "benchmark" — cocok dengan seluruh 10.000 baris (kasus terburuk) → 20 baris (total=10000) |
| search + filter verse |     53.2 ms |     54.6 ms |     55.7 ms | 20 | query "benchmark" dibatasi satu verse → 20 baris (total=500) |
| search + filter media |    941.2 ms |    953.1 ms |    996.4 ms | 20 | query "benchmark" dibatasi media manga → 20 baris (total=10000) |
| autocomplete (perPage 10) |    570.5 ms |    579.8 ms |    596.6 ms | 3 | RPC yang sama dengan /api/search/suggest → 3 baris (total=3) |
| daftar karakter hal. 1 |      1.8 ms |      2.1 ms |      2.1 ms | 24 | limit 24, urut popularitas+nama → 24 baris |
| daftar karakter hal. 209 (offset jauh) |     18.2 ms |     18.6 ms |     18.8 ms | 24 | offset 5.000 — biaya OFFSET → 24 baris |
| count karakter |      6.3 ms |      6.9 ms |      7.0 ms | 1 | dipakai header daftar → 1 baris (10000) |
| detail karakter |      1.5 ms |      1.8 ms |      1.8 ms | 1 | getCharacterBySlug → 1 baris |
| pemilih form |      1.3 ms |      1.9 ms |      2.1 ms | 1 | listCharacterForms (form kedua ada) → 1 baris (form=1) |
| statistik form |      1.5 ms |      1.9 ms |      2.1 ms | 3 | listFormStatistics → 3 baris |
| ability form |      1.9 ms |      3.2 ms |      3.7 ms | 3 | listFormAbilities (join katalog + sumber) → 3 baris |
| resistensi form |      1.7 ms |      2.0 ms |      2.0 ms | 1 | listFormResistances → 1 baris |
| daftar verse |     28.9 ms |     29.2 ms |     29.2 ms | 20 | listVerses — 20 verse, dihitung per verse → 20 baris |
| karakter per verse |      9.8 ms |     10.2 ms |     10.5 ms | 50 | listVerseCharacters (500 baris per verse) → 50 baris |
| dataset battle (RPC) |     18.3 ms |     18.9 ms |     19.4 ms | 1 | battle_dataset untuk 2 form — satu round-trip simulasi → 1 baris (entries=1) |

Semua angka dari PGlite dalam proses yang sama (tanpa jaringan/SSL ke Supabase), jadi ini batas bawah relatif: yang diukur adalah bentuk query, pemakaian index, dan biaya relatif antar query — bukan latency produksi.

### search karakter luas ("benchmark")

```
Function Scan on search_characters_page  (cost=0.25..0.26 rows=1 width=32) (actual time=951.535..951.538 rows=1 loops=1)
  Buffers: shared hit=96609
Planning Time: 0.575 ms
Execution Time: 951.683 ms
```

### search luas + filter media ("benchmark", manga)

```
Function Scan on search_characters_page  (cost=0.25..0.26 rows=1 width=32) (actual time=940.760..940.764 rows=1 loops=1)
  Buffers: shared hit=96609
Planning Time: 0.546 ms
Execution Time: 940.792 ms
```

### search selektif ("gokuto bench")

```
Function Scan on search_characters_page  (cost=0.25..0.26 rows=1 width=32) (actual time=652.145..652.148 rows=1 loops=1)
  Buffers: shared hit=45072
Planning Time: 0.546 ms
Execution Time: 652.175 ms
```

### search berhalaman + filter verse ("benchmark")

```
Result  (cost=0.00..0.26 rows=1 width=32) (actual time=50.722..50.724 rows=1 loops=1)
  Buffers: shared hit=4854
Planning Time: 0.534 ms
Execution Time: 50.748 ms
```

### probe index trigram pada characters (name + native)

```
Append  (cost=920.11..2720.02 rows=300 width=16) (actual time=9.465..35.844 rows=6 loops=1)
  Buffers: shared hit=1678
  ->  Bitmap Heap Scan on characters  (cost=920.11..1385.29 rows=150 width=16) (actual time=9.460..9.889 rows=3 loops=1)
        Recheck Cond: (TRIM(BOTH FROM regexp_replace(regexp_replace(lower(f_unaccent(COALESCE(name, ''::text))), '[^[:alnum:][:space:]]'::text, ''::text, 'g'::text), '\s+'::text, ' '::text, 'g'::text)) % 'gokuto'::text)
        Heap Blocks: exact=2
        Buffers: shared hit=218
        ->  Bitmap Index Scan on idx_characters_name_trgm  (cost=0.00..920.08 rows=150 width=0) (actual time=9.260..9.261 rows=9 loops=1)
              Index Cond: (TRIM(BOTH FROM regexp_replace(regexp_replace(lower(f_unaccent(COALESCE(name, ''::text))), '[^[:alnum:][:space:]]'::text, ''::text, 'g'::text), '\s+'::text, ' '::text, 'g'::text)) % 'gokuto'::text)
              Buffers: shared hit=216
  ->  Bitmap Heap Scan on characters characters_1  (cost=907.05..1333.23 rows=150 width=16) (actual time=22.263..25.930 rows=3 loops=1)
        Recheck Cond: (COALESCE(native_name, ''::text) % 'ベンチゴクト'::text)
        Rows Removed by Index Recheck: 2500
        Heap Blocks: exact=1247
        Buffers: shared hit=1460
        ->  Bitmap Index Scan on idx_characters_native_trgm  (cost=0.00..907.01 rows=150 width=0) (actual time=13.849..13.849 rows=5835 loops=1)
              Index Cond: (COALESCE(native_name, ''::text) % 'ベンチゴクト'::text)
              Buffers: shared hit=213
Planning:
  Buffers: shared hit=7
Planning Time: 1.443 ms
Execution Time: 36.019 ms
```

### daftar karakter offset 5.000

```
Limit  (cost=2030.28..2039.89 rows=24 width=160) (actual time=28.644..28.676 rows=24 loops=1)
  Buffers: shared hit=11786
  ->  Incremental Sort  (cost=29.44..6022.37 rows=14976 width=160) (actual time=0.346..25.676 rows=5024 loops=1)
        Sort Key: popularity_score DESC, name
        Presorted Key: popularity_score
        Full-sort Groups: 126  Sort Method: quicksort  Average Memory: 22kB  Peak Memory: 22kB
        Buffers: shared hit=11786
        ->  Index Scan using idx_characters_popularity on characters  (cost=0.29..5364.93 rows=14976 width=160) (actual time=0.029..14.540 rows=5031 loops=1)
              Buffers: shared hit=11786
Planning Time: 0.156 ms
Execution Time: 28.821 ms
```

