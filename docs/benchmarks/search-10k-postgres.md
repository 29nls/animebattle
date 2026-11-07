## Benchmark pencarian — dataset sintetis 10.000 karakter (PostgreSQL 16.15 (TCP, binary asli))

Bentuk dataset: 10.000 karakter, 11.982 form, 3.338 alias, 6.000 statistik, 1.500 ability, 500 resistensi, 20 verse. Seeding 29609 ms.

| Query | p50 | p95 | max | baris | catatan |
| --- | ---: | ---: | ---: | ---: | --- |
| search selektif (nama) |    289.8 ms |    328.7 ms |    332.1 ms | 3 | "gokuto bench" — 3 dari 10.000 baris → 3 baris (total=3) |
| search alias |    129.3 ms |    155.7 ms |    185.9 ms | 3 | "kakarotto" → record kanonik → 3 baris (total=3) |
| search typo |    126.2 ms |    154.5 ms |    158.4 ms | 3 | "kakarotp" → toleransi trigram pada alias → 3 baris (total=3) |
| search prefiks |    113.5 ms |    140.9 ms |    142.0 ms | 3 | "goku" → awalan nama → 3 baris (total=3) |
| search prefiks 2 huruf |     64.6 ms |     82.1 ms |     93.6 ms | 3 | "go" → awalan nama (jalur autocomplete selektif) → 3 baris (total=3) |
| search prefiks 2 huruf (luas) |    157.0 ms |    197.6 ms |    219.4 ms | 20 | "be" → cocok dengan seluruh 10.000 baris lewat awalan nama → 20 baris (total=9997) |
| search unicode (CJK) |    145.6 ms |    182.4 ms |    203.0 ms | 3 | "ベンチゴクト" → native_name → 3 baris (total=3) |
| search luas |    368.2 ms |    444.7 ms |    468.2 ms | 20 | "benchmark" — cocok dengan seluruh 10.000 baris (kasus terburuk) → 20 baris (total=10000) |
| search lintas tipe (karakter+verse) |    364.9 ms |    397.0 ms |    407.4 ms | 20 | types=[character,verse] pada kueri luas "benchmark" → 20 baris (total=10020 types=character) |
| search + filter verse |    308.9 ms |    355.4 ms |    358.4 ms | 20 | query "benchmark" dibatasi satu verse → 20 baris (total=500) |
| search + filter media |    322.0 ms |    357.9 ms |    365.1 ms | 20 | query "benchmark" dibatasi media manga → 20 baris (total=10000) |
| autocomplete (perPage 10) |     44.2 ms |     58.9 ms |     60.4 ms | 3 | RPC yang sama dengan /api/search/suggest → 3 baris (total=3) |
| daftar karakter hal. 1 |      3.8 ms |      5.4 ms |      5.4 ms | 24 | limit 24, urut popularitas+nama → 24 baris |
| daftar karakter hal. 209 (offset jauh) |     72.5 ms |     98.6 ms |    103.7 ms | 24 | offset 5.000 — biaya OFFSET → 24 baris |
| count karakter |      6.5 ms |     10.8 ms |     22.6 ms | 1 | dipakai header daftar → 1 baris (10000) |
| detail karakter |      1.7 ms |      2.1 ms |      2.1 ms | 1 | getCharacterBySlug → 1 baris |
| pemilih form |      1.3 ms |      1.6 ms |      1.7 ms | 1 | listCharacterForms (form kedua ada) → 1 baris (form=1) |
| statistik form |      1.8 ms |      2.2 ms |      2.2 ms | 3 | listFormStatistics → 3 baris |
| ability form |      2.2 ms |      3.2 ms |      3.8 ms | 3 | listFormAbilities (join katalog + sumber) → 3 baris |
| resistensi form |      1.7 ms |      2.3 ms |      2.6 ms | 1 | listFormResistances → 1 baris |
| daftar verse |      3.0 ms |      4.0 ms |      4.4 ms | 20 | listVerses — 20 verse, dihitung per verse → 20 baris |
| karakter per verse |      4.7 ms |      6.4 ms |      6.7 ms | 50 | listVerseCharacters (500 baris per verse) → 50 baris |
| dataset battle (RPC) |     35.8 ms |     52.2 ms |     55.3 ms | 1 | battle_dataset untuk 2 form — satu round-trip simulasi → 1 baris (entries=1) |

Angka dari PostgreSQL asli lewat TCP loopback (satu koneksi, tanpa batas jaringan produksi). Yang diukur: bentuk query, pemakaian index, dan biaya relatif antar query — bukan latency Supabase dari region lain.

### search karakter luas ("benchmark")

```
Function Scan on search_characters_page  (cost=0.25..0.26 rows=1 width=32) (actual time=433.976..433.977 rows=1 loops=1)
  Buffers: shared hit=13457
Planning Time: 0.076 ms
Execution Time: 434.957 ms
```

### search luas + filter media ("benchmark", manga)

```
Function Scan on search_characters_page  (cost=0.25..0.26 rows=1 width=32) (actual time=407.616..407.618 rows=1 loops=1)
  Buffers: shared hit=13457
Planning Time: 0.072 ms
Execution Time: 408.840 ms
```

### search selektif ("gokuto bench")

```
Function Scan on search_characters_page  (cost=0.25..0.26 rows=1 width=32) (actual time=395.344..395.345 rows=1 loops=1)
  Buffers: shared hit=10533
Planning Time: 0.080 ms
Execution Time: 396.122 ms
```

### search prefiks 2 huruf luas ("be")

```
Function Scan on search_characters_page  (cost=0.25..0.26 rows=1 width=32) (actual time=155.847..155.848 rows=1 loops=1)
  Buffers: shared hit=11549
Planning Time: 0.074 ms
Execution Time: 156.606 ms
```

### search berhalaman + filter verse ("benchmark")

```
Result  (cost=0.00..0.26 rows=1 width=32) (actual time=316.732..316.734 rows=1 loops=1)
  Buffers: shared hit=4587
Planning Time: 0.069 ms
Execution Time: 317.585 ms
```

### probe index trigram pada characters (name + native)

```
Append  (cost=64.92..156.88 rows=7 width=16) (actual time=0.048..24.731 rows=6 loops=1)
  Buffers: shared hit=872
  ->  Bitmap Heap Scan on characters  (cost=64.92..80.31 rows=4 width=16) (actual time=0.047..0.062 rows=3 loops=1)
        Recheck Cond: (name_norm % 'gokuto'::text)
        Heap Blocks: exact=1
        Buffers: shared hit=16
        ->  Bitmap Index Scan on idx_characters_name_trgm  (cost=0.00..64.92 rows=4 width=0) (actual time=0.030..0.030 rows=3 loops=1)
              Index Cond: (name_norm % 'gokuto'::text)
              Buffers: shared hit=15
  ->  Bitmap Heap Scan on characters characters_1  (cost=64.92..76.53 rows=3 width=16) (actual time=18.024..24.662 rows=3 loops=1)
        Recheck Cond: (native_norm % 'ベンチゴクト'::text)
        Rows Removed by Index Recheck: 2500
        Heap Blocks: exact=838
        Buffers: shared hit=856
        ->  Bitmap Index Scan on idx_characters_native_trgm  (cost=0.00..64.92 rows=3 width=0) (actual time=1.051..1.051 rows=2503 loops=1)
              Index Cond: (native_norm % 'ベンチゴクト'::text)
              Buffers: shared hit=18
Planning:
  Buffers: shared hit=5
Planning Time: 2.373 ms
Execution Time: 24.840 ms
```

### daftar karakter offset 5.000

```
Limit  (cost=2096.89..2096.95 rows=24 width=117) (actual time=46.735..46.744 rows=24 loops=1)
  Buffers: shared hit=1320
  ->  Sort  (cost=2084.39..2109.39 rows=10000 width=117) (actual time=45.584..46.369 rows=5024 loops=1)
        Sort Key: popularity_score DESC, name
        Sort Method: quicksort  Memory: 1713kB
        Buffers: shared hit=1320
        ->  Seq Scan on characters  (cost=0.00..1420.00 rows=10000 width=117) (actual time=0.318..7.344 rows=10000 loops=1)
              Buffers: shared hit=1320
Planning Time: 0.261 ms
Execution Time: 47.206 ms
```

