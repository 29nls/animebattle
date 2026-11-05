## Benchmark pencarian — dataset sintetis 10.000 karakter (PostgreSQL 16.15 (TCP, binary asli))

Bentuk dataset: 10.000 karakter, 11.982 form, 3.338 alias, 6.000 statistik, 1.500 ability, 500 resistensi, 20 verse. Seeding 15747 ms.

| Query | p50 | p95 | max | baris | catatan |
| --- | ---: | ---: | ---: | ---: | --- |
| search selektif (nama) |   2293.9 ms |   2371.5 ms |   2444.0 ms | 3 | "gokuto bench" — 3 dari 10.000 baris → 3 baris (total=3) |
| search prefiks 2 huruf |   2081.6 ms |   2285.5 ms |   2368.9 ms | 3 | "go" → awalan nama (jalur autocomplete selektif) → 3 baris (total=3) |
| search prefiks 2 huruf (luas) |   3936.6 ms |   4177.0 ms |   4431.6 ms | 20 | "be" → cocok dengan seluruh 10.000 baris lewat awalan nama → 20 baris (total=9997) |
| search luas |   2418.1 ms |   2568.7 ms |   2587.7 ms | 20 | "benchmark" — cocok dengan seluruh 10.000 baris (kasus terburuk) → 20 baris (total=10000) |

Angka dari PostgreSQL asli lewat TCP loopback (satu koneksi, tanpa batas jaringan produksi). Yang diukur: bentuk query, pemakaian index, dan biaya relatif antar query — bukan latency Supabase dari region lain.

### search karakter luas ("benchmark")

```
Function Scan on search_characters_page  (cost=0.25..0.26 rows=1 width=32) (actual time=2419.025..2419.026 rows=1 loops=1)
  Buffers: shared hit=82666
Planning Time: 0.024 ms
Execution Time: 2419.184 ms
```

### search luas + filter media ("benchmark", manga)

```
Function Scan on search_characters_page  (cost=0.25..0.26 rows=1 width=32) (actual time=2433.722..2433.723 rows=1 loops=1)
  Buffers: shared hit=82666
Planning Time: 0.022 ms
Execution Time: 2433.871 ms
```

### search selektif ("gokuto bench")

```
Function Scan on search_characters_page  (cost=0.25..0.26 rows=1 width=32) (actual time=2194.287..2194.288 rows=1 loops=1)
  Buffers: shared hit=32681
Planning Time: 0.022 ms
Execution Time: 2194.345 ms
```

### search prefiks 2 huruf luas ("be")

```
Function Scan on search_characters_page  (cost=0.25..0.26 rows=1 width=32) (actual time=3981.559..3981.560 rows=1 loops=1)
  Buffers: shared hit=82651
Planning Time: 0.023 ms
Execution Time: 3981.782 ms
```

### search berhalaman + filter verse ("benchmark")

```
Result  (cost=0.00..0.26 rows=1 width=32) (actual time=125.160..125.161 rows=1 loops=1)
  Buffers: shared hit=4144
Planning Time: 0.021 ms
Execution Time: 125.259 ms
```

### probe index trigram pada characters (name + native)

```
Append  (cost=64.92..1454.32 rows=5 width=16) (actual time=0.205..14.812 rows=3 loops=1)
  Buffers: shared hit=1264
  ->  Bitmap Heap Scan on characters  (cost=64.92..81.29 rows=4 width=16) (actual time=0.205..0.314 rows=3 loops=1)
        Recheck Cond: (f_normalize_name(name) % 'gokuto'::text)
        Heap Blocks: exact=1
        Buffers: shared hit=16
        ->  Bitmap Index Scan on idx_characters_name_trgm  (cost=0.00..64.92 rows=4 width=0) (actual time=0.032..0.032 rows=3 loops=1)
              Index Cond: (f_normalize_name(name) % 'gokuto'::text)
              Buffers: shared hit=15
  ->  Seq Scan on characters characters_1  (cost=0.00..1373.00 rows=1 width=16) (actual time=14.495..14.495 rows=0 loops=1)
        Filter: (COALESCE(native_name, ''::text) % 'ベンチゴクト'::text)
        Rows Removed by Filter: 10000
        Buffers: shared hit=1248
Planning:
  Buffers: shared hit=22
Planning Time: 1.297 ms
Execution Time: 14.863 ms
```

### daftar karakter offset 5.000

```
Limit  (cost=2024.89..2024.95 rows=24 width=117) (actual time=16.557..16.563 rows=24 loops=1)
  Buffers: shared hit=1248
  ->  Sort  (cost=2012.39..2037.39 rows=10000 width=117) (actual time=15.766..16.246 rows=5024 loops=1)
        Sort Key: popularity_score DESC, name
        Sort Method: quicksort  Memory: 1713kB
        Buffers: shared hit=1248
        ->  Seq Scan on characters  (cost=0.00..1348.00 rows=10000 width=117) (actual time=0.245..5.496 rows=10000 loops=1)
              Buffers: shared hit=1248
Planning:
  Buffers: shared hit=6
Planning Time: 0.208 ms
Execution Time: 16.985 ms
```

