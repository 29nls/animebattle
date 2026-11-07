-- ============================================================================
-- Anime VS Battle — seed data konfigurasi Cloudflare D1 (SQLite)
-- Berisi data konfigurasi/taksonomi: sumber internal, metrik, skala nilai,
-- ladder tier, katalog kategori ability, tipe resistensi, aturan interaksi hax,
-- dan rule set battle default.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sumber internal (tempat atribusi record editorial/admin)
-- ---------------------------------------------------------------------------
insert into sources (slug, name, base_url, source_type, priority, legal_status,
                     legal_reviewed_by, legal_reviewed_at, respect_robots,
                     rate_limit_rps, max_fetches_per_day,
                     license, license_url, attribution_text, is_active)
values
  ('internal-editorial', 'Internal Editorial', 'about:editorial', 'official', 3, 'allowed',
   'product-owner', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 1, 0.5, 500,
   'internal-use', null,
   'Dikelola langsung oleh editor Anime VS Battle.', 1),
  ('admin-dataset-import', 'Admin Dataset Import', 'about:dataset', 'dataset', 3, 'allowed',
   'product-owner', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 1, 0.5, 1000,
   'per-dataset', null,
   'Diimpor oleh admin dari dataset berlisensi; lisensi dicatat per dataset.', 1)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Metrik stat
-- ---------------------------------------------------------------------------
insert into stat_scale_metrics (metric, label, unit, higher_is_better, normalization_span, description)
values
  ('tier',              'Tier',               'ordinal',       1, 8,  'Peringkat kekuatan keseluruhan; rank dari tabel tiers.numerical_rank'),
  ('attack_potency',    'Attack Potency',     'log10_joule',   1, 10, 'Energi serangan terukur (eksponen basis-10 joule)'),
  ('durability',        'Durability',         'log10_joule',   1, 10, 'Energi maksimum yang dapat ditahan'),
  ('striking_strength', 'Striking Strength',  'log10_joule',   1, 10, 'Energi serangan fisik langsung'),
  ('lifting_strength',  'Lifting Strength',   'log10_kg',      1, 10, 'Massa maksimum yang dapat diangkat (eksponen basis-10 kg)'),
  ('speed',             'Speed',              'log10_m_s',     1, 10, 'Kecepatan gerak; rezim FTL memakai skala c-multiple bertanda non-fisik'),
  ('reaction_speed',    'Reaction Speed',     'log10_m_s',     1, 8,  'Kecepatan minimum objek yang dapat direspons'),
  ('combat_speed',      'Combat Speed',       'log10_aps',     1, 8,  'Aksi per detik dalam pertarungan (eksponen basis-10)'),
  ('range',             'Range',              'log10_meter',   1, 8,  'Jangkauan efektif serangan/ability (eksponen basis-10 meter)'),
  ('stamina',           'Stamina',            'ordinal',       1, 2,  'Durasi aktivitas puncak sebelum kelelahan'),
  ('intelligence',      'Intelligence',       'ordinal',       1, 2,  'Kapasitas kognitif umum'),
  ('battle_iq',         'Battle IQ',          'ordinal',       1, 2,  'Kualitas pengambilan keputusan dalam pertarungan'),
  ('experience',        'Experience',         'years',         1, 4,  'Pengalaman tempur dalam tahun aktif')
on conflict (metric) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Skala nilai per metrik
-- ---------------------------------------------------------------------------
with v(metric, scale_code, label, rank, log_value, band, is_rankable, is_physical, notes) as (
  values
    -- Attack Potency / Durability / Striking Strength (energi, log10 joule)
    ('attack_potency','below_average_human','Below Average Human', 1,  1.0,'low', 1, 1, null),
    ('attack_potency','athlete_human','Athlete Human',             2,  3.0,'low', 1, 1, null),
    ('attack_potency','wall','Wall level',                         3,  6.0,'low', 1, 1, null),
    ('attack_potency','small_building','Small Building level',     4,  8.0,'low', 1, 1, null),
    ('attack_potency','building','Building level',                 5,  9.5,'mid', 1, 1, null),
    ('attack_potency','large_building','Large Building level',     6, 10.5,'mid', 1, 1, null),
    ('attack_potency','city_block','City Block level',             7, 12.0,'mid', 1, 1, null),
    ('attack_potency','multi_city_block','Multi-City Block level',  8, 13.0,'mid', 1, 1, null),
    ('attack_potency','town','Town level',                          9, 14.5,'mid', 1, 1, null),
    ('attack_potency','small_city','Small City level',             10, 15.5,'mid', 1, 1, null),
    ('attack_potency','city','City level',                        11, 17.0,'mid', 1, 1, 'Referensi: energi nuklir skala kota ~1e17 J'),
    ('attack_potency','mountain','Mountain level',                 12, 19.0,'high', 1, 1, null),
    ('attack_potency','large_mountain','Large Mountain level',      13, 19.5,'high', 1, 1, null),
    ('attack_potency','island','Island level',                    14, 21.0,'high', 1, 1, 'Dipakai sebagai contoh pada validasi skema'),
    ('attack_potency','large_island','Large Island level',          15, 22.0,'high', 1, 1, null),
    ('attack_potency','country','Country level',                   16, 23.0,'high', 1, 1, null),
    ('attack_potency','large_country','Large Country level',        17, 24.0,'high', 1, 1, null),
    ('attack_potency','multi_continental','Multi-Continental level',18, 25.0,'high', 1, 1, null),
    ('attack_potency','moon','Moon level',                         19, 29.2,'peak', 1, 1, 'Energi ikat gravitasi bulan ~1.2e29 J'),
    ('attack_potency','small_planet','Small Planet level',          20, 31.0,'peak', 1, 1, null),
    ('attack_potency','planet','Planet level',                     21, 32.5,'peak', 1, 1, 'Energi ikat gravitasi bumi ~2.2e32 J'),
    ('attack_potency','large_planet','Large Planet level',          22, 33.5,'peak', 1, 1, null),
    ('attack_potency','dwarf_star','Dwarf Star level',              23, 39.0,'peak', 1, 1, null),
    ('attack_potency','star','Star level',                         24, 44.0,'peak', 1, 1, 'Referensi: supernova tipikal ~1e44 J'),
    ('attack_potency','large_star','Large Star level',              25, 45.5,'peak', 1, 1, null),
    ('attack_potency','solar_system','Solar System level',          26, 48.0,'peak', 1, 1, null),
    ('attack_potency','multi_solar_system','Multi-Solar System level',27, 50.0,'peak', 1, 1, null),
    ('attack_potency','galaxy','Galaxy level',                     28, 57.0,'peak', 1, 1, null),
    ('attack_potency','multi_galaxy','Multi-Galaxy level',           29, 59.0,'peak', 1, 1, null),
    ('attack_potency','universal','Universal level',                30, 62.0,'peak', 1, 0, 'Rezim kosmologis; log_value indikatif'),
    ('attack_potency','low_multiversal','Low Multiversal level',    31, 65.0,'peak', 1, 0, null),
    ('attack_potency','multiversal','Multiversal level',            32, 68.0,'peak', 1, 0, null),
    ('attack_potency','high_multiversal','High Multiversal level',  33, 70.0,'peak', 1, 0, null),
    ('attack_potency','outerversal','Outerversal level',            34, null,'peak', 1, 0, 'Di luar kerangka kuantifikasi energi'),
    ('attack_potency','boundless','Boundless',                      35, null,'peak', 1, 0, 'Tanpa batas terukur'),

    -- Speed: rank 1-12 fisik (log10 m/s), rank 13+ rezim FTL (log10 kelipatan c)
    ('speed','subsonic','Subsonic',                          1, 1.70,'low', 1, 1, '~50 m/s'),
    ('speed','subsonic_plus','Subsonic+',                    2, 2.30,'low', 1, 1, '~200 m/s'),
    ('speed','supersonic','Supersonic',                      3, 2.60,'low', 1, 1, '~400 m/s (Mach 1.2)'),
    ('speed','supersonic_plus','Supersonic+',                4, 3.11,'low', 1, 1, '~1300 m/s'),
    ('speed','hypersonic','Hypersonic',                      5, 3.53,'mid', 1, 1, '~3400 m/s (Mach 10)'),
    ('speed','hypersonic_plus','Hypersonic+',                6, 3.90,'mid', 1, 1, '~8000 m/s'),
    ('speed','high_hypersonic','High Hypersonic',            7, 4.30,'mid', 1, 1, '~20000 m/s'),
    ('speed','massively_hypersonic','Massively Hypersonic',  8, 5.48,'mid', 1, 1, '~300000 m/s'),
    ('speed','massively_hypersonic_plus','Massively Hypersonic+', 9, 6.48,'mid', 1, 1, '~3e6 m/s'),
    ('speed','sub_relativistic','Sub-Relativistic',         10, 7.48,'high', 1, 1, '~0.1c'),
    ('speed','relativistic','Relativistic',                 11, 8.18,'high', 1, 1, '~0.5c'),
    ('speed','relativistic_plus','Relativistic+',           12, 8.43,'high', 1, 1, '~0.9c'),
    ('speed','light_speed','Speed of Light',                13, 8.477,'high', 1, 1, 'c = 2.998e8 m/s'),
    ('speed','ftl','FTL',                                   14, 0.00,'peak', 1, 0, 'Mulai sini log_value = log10(kelipatan c)'),
    ('speed','ftl_plus','FTL+',                             15, 0.50,'peak', 1, 0, '~3c'),
    ('speed','massively_ftl','Massively FTL',               16, 2.00,'peak', 1, 0, '~100c'),
    ('speed','mftl_plus','Massively FTL+',                  17, 4.00,'peak', 1, 0, '~10000c'),
    ('speed','immeasurable','Immeasurable',                 18, null,'peak', 1, 0, 'Melampaui kerangka kecepatan linier'),
    ('speed','irrelevant','Irrelevant',                     19, null,'peak', 1, 0, null),
    ('speed','infinite','Infinite',                         20, null,'peak', 1, 0, null),

    -- Reaction Speed (log10 m/s untuk rezim fisik)
    ('reaction_speed','average_human','Average Human',            1, 0.70,'low', 1, 1, '~5 m/s'),
    ('reaction_speed','athletic_human','Athletic Human',          2, 1.00,'low', 1, 1, '~10 m/s'),
    ('reaction_speed','superhuman','Superhuman',                  3, 1.70,'mid', 1, 1, '~50 m/s'),
    ('reaction_speed','subsonic','Subsonic',                      4, 2.48,'mid', 1, 1, '~300 m/s'),
    ('reaction_speed','supersonic','Supersonic',                  5, 3.00,'mid', 1, 1, '~1000 m/s'),
    ('reaction_speed','hypersonic','Hypersonic',                  6, 3.90,'high', 1, 1, '~8000 m/s'),
    ('reaction_speed','massively_hypersonic','Massively Hypersonic',7, 5.48,'high', 1, 1, '~300000 m/s'),
    ('reaction_speed','relativistic','Relativistic',              8, 8.18,'high', 1, 1, '~0.5c'),
    ('reaction_speed','ftl','FTL',                                9, 0.00,'peak', 1, 0, 'log10(kelipatan c)'),
    ('reaction_speed','massively_ftl','Massively FTL',           10, 2.00,'peak', 1, 0, null),
    ('reaction_speed','immeasurable','Immeasurable',             11, null,'peak', 1, 0, null),

    -- Combat Speed (aksi per detik)
    ('combat_speed','human','Human',                       1, 0.30,'low', 1, 1, '~2 aksi/detik'),
    ('combat_speed','athletic','Athletic',                 2, 0.70,'low', 1, 1, '~5 aksi/detik'),
    ('combat_speed','superhuman','Superhuman',             3, 1.00,'mid', 1, 1, '~10 aksi/detik'),
    ('combat_speed','peak_superhuman','Peak Superhuman',   4, 1.70,'mid', 1, 1, '~50 aksi/detik'),
    ('combat_speed','massively_superhuman','Massively Superhuman',5, 2.70,'mid', 1, 1, '~500 aksi/detik'),
    ('combat_speed','thousands','Thousands of actions',    6, 3.70,'high', 1, 1, null),
    ('combat_speed','millions','Millions of actions',      7, 6.00,'high', 1, 1, null),
    ('combat_speed','billions','Billions of actions',      8, 9.00,'peak', 1, 1, null),
    ('combat_speed','trillions','Trillions of actions',    9,12.00,'peak', 1, 0, null),
    ('combat_speed','instant','Effectively instant',      10, null,'peak', 1, 0, null),

    -- Lifting Strength (log10 kg)
    ('lifting_strength','below_average_human','Below Average Human',1, 1.70,'low', 1, 1, '~50 kg'),
    ('lifting_strength','average_human','Average Human',          2, 1.90,'low', 1, 1, null),
    ('lifting_strength','above_average_human','Above Average Human',3,2.30,'low', 1, 1, '~200 kg'),
    ('lifting_strength','athletic_human','Athletic Human',        4, 2.40,'low', 1, 1, '~250 kg'),
    ('lifting_strength','peak_human','Peak Human',                5, 2.70,'mid', 1, 1, '~500 kg'),
    ('lifting_strength','class_1','Class 1',                      6, 3.00,'mid', 1, 1, '~1e3 kg'),
    ('lifting_strength','class_5','Class 5',                      7, 3.70,'mid', 1, 1, '~5e3 kg'),
    ('lifting_strength','class_10','Class 10',                    8, 4.00,'mid', 1, 1, null),
    ('lifting_strength','class_25','Class 25',                    9, 4.40,'mid', 1, 1, null),
    ('lifting_strength','class_50','Class 50',                   10, 4.70,'mid', 1, 1, null),
    ('lifting_strength','class_100','Class 100',                 11, 5.00,'high', 1, 1, null),
    ('lifting_strength','class_k','Class K',                     12, 6.00,'high', 1, 1, '~1e6 kg'),
    ('lifting_strength','class_m','Class M',                     13, 9.00,'high', 1, 1, '~1e9 kg (gunung kecil)'),
    ('lifting_strength','class_g','Class G',                     14,12.00,'high', 1, 1, '~1e12 kg'),
    ('lifting_strength','class_t','Class T',                     15,15.00,'peak', 1, 1, '~1e15 kg'),
    ('lifting_strength','class_p','Class P',                     16,18.00,'peak', 1, 1, '~1e18 kg'),
    ('lifting_strength','class_z','Class Z',                     17,21.00,'peak', 1, 1, '~1e21 kg'),
    ('lifting_strength','class_y','Class Y',                     18,24.00,'peak', 1, 1, '~1e24 kg'),
    ('lifting_strength','pre_stellar','Pre-Stellar',             19,27.00,'peak', 1, 1, null),
    ('lifting_strength','stellar','Stellar',                     20,30.50,'peak', 1, 1, '~1e30 kg (orde massa matahari)'),
    ('lifting_strength','multi_stellar','Multi-Stellar',         21,33.00,'peak', 1, 0, null),
    ('lifting_strength','galactic','Galactic',                   22,42.00,'peak', 1, 0, null),
    ('lifting_strength','multi_galactic','Multi-Galactic',       23,45.00,'peak', 1, 0, null),
    ('lifting_strength','universal','Universal',                 24,53.00,'peak', 1, 0, null),
    ('lifting_strength','immeasurable','Immeasurable',           25, null,'peak', 1, 0, null),

    -- Range (log10 meter)
    ('range','standard_melee','Standard Melee Range',       1,  0.00,'low', 1, 1, '~1 m'),
    ('range','extended_melee','Extended Melee Range',       2,  0.70,'low', 1, 1, '~5 m'),
    ('range','several_meters','Several Meters',             3,  1.00,'low', 1, 1, '~10 m'),
    ('range','tens_of_meters','Tens of Meters',             4,  1.70,'low', 1, 1, '~50 m'),
    ('range','hundreds_of_meters','Hundreds of Meters',     5,  2.70,'mid', 1, 1, '~500 m'),
    ('range','kilometers','Kilometers',                     6,  3.70,'mid', 1, 1, '~5 km'),
    ('range','tens_of_kilometers','Tens of Kilometers',     7,  4.70,'mid', 1, 1, '~50 km'),
    ('range','hundreds_of_kilometers','Hundreds of Kilometers',8,5.70,'high', 1, 1, '~500 km'),
    ('range','thousands_of_kilometers','Thousands of Kilometers',9,6.70,'high',1, 1, '~5000 km'),
    ('range','planetary','Planetary',                      10,  7.10,'high', 1, 1, '~1.27e7 m'),
    ('range','stellar','Stellar',                          11,  9.50,'peak', 1, 1, '~3e9 m'),
    ('range','interplanetary','Interplanetary',            12, 11.50,'peak', 1, 1, null),
    ('range','interstellar','Interstellar',                13, 18.50,'peak', 1, 1, null),
    ('range','galactic','Galactic',                        14, 21.00,'peak', 1, 0, null),
    ('range','intergalactic','Intergalactic',              15, 23.00,'peak', 1, 0, null),
    ('range','universal','Universal',                      16, 26.50,'peak', 1, 0, null),
    ('range','low_multiversal','Low Multiversal',          17,  null,'peak', 1, 0, null),
    ('range','multiversal','Multiversal',                  18,  null,'peak', 1, 0, null),
    ('range','high_multiversal','High Multiversal',        19,  null,'peak', 1, 0, null),
    ('range','irrelevant','Irrelevant',                    20,  null,'peak', 1, 0, null),

    -- Stamina (deskriptif)
    ('stamina','very_low','Very Low',           1, 0.70,'low', 1, 1, 'Kehilangan tenaga dalam detik'),
    ('stamina','low','Low',                     2, 1.70,'low', 1, 1, 'Di bawah satu menit'),
    ('stamina','below_average','Below Average',  3, 2.70,'low', 1, 1, 'Beberapa menit'),
    ('stamina','average','Average',             4, 3.30,'mid', 1, 1, 'Puluhan menit'),
    ('stamina','athletic','Athletic',           5, 4.00,'mid', 1, 1, 'Beberapa jam'),
    ('stamina','peak_human','Peak Human',       6, 4.70,'mid', 1, 1, 'Berjam-jam tanpa penurunan berarti'),
    ('stamina','superhuman','Superhuman',       7, 5.70,'high', 1, 1, 'Berhari-hari'),
    ('stamina','very_high','Very High',         8, 6.70,'high', 1, 1, 'Berminggu-minggu'),
    ('stamina','extreme','Extreme',             9, 7.70,'peak', 1, 1, 'Berbulan-bulan'),
    ('stamina','godlike','Godlike',            10, 8.70,'peak', 1, 0, 'Efektif tak terbatas, dengan justifikasi'),
    ('stamina','infinite','Infinite',          11,  null,'peak', 1, 0, null),

    -- Intelligence (deskriptif)
    ('intelligence','animalistic','Animalistic',           1, 0.00,'low', 1, 1, null),
    ('intelligence','low','Low',                           2, 0.70,'low', 1, 1, null),
    ('intelligence','below_average','Below Average',        3, 1.10,'low', 1, 1, null),
    ('intelligence','average','Average',                   4, 1.50,'mid', 1, 1, null),
    ('intelligence','above_average','Above Average',        5, 1.80,'mid', 1, 1, null),
    ('intelligence','gifted','Gifted',                     6, 2.20,'high', 1, 1, null),
    ('intelligence','genius','Genius',                     7, 2.60,'high', 1, 1, null),
    ('intelligence','extraordinary_genius','Extraordinary Genius',8,3.00,'peak',1,1,null),
    ('intelligence','supergenius','Supergenius',           9, 3.40,'peak', 1, 0, null),
    ('intelligence','nigh_omniscient','Nigh-Omniscient',  10, 3.80,'peak', 1, 0, null),
    ('intelligence','omniscient','Omniscient',            11,  null,'peak', 1, 0, null),

    -- Battle IQ
    ('battle_iq','instinct_only','Instinct Only',              1, 0.00,'low', 1, 1, 'Bertarung murni naluri'),
    ('battle_iq','basic','Basic',                              2, 0.70,'low', 1, 1, null),
    ('battle_iq','trained','Trained',                          3, 1.30,'mid', 1, 1, 'Terlatih secara formal'),
    ('battle_iq','tactical','Tactical',                        4, 1.80,'mid', 1, 1, 'Menyesuaikan taktik di tengah pertarungan'),
    ('battle_iq','strategic','Strategic',                      5, 2.30,'high', 1, 1, 'Menyusun rencana multi-tahap'),
    ('battle_iq','master_strategist','Master Strategist',      6, 2.70,'high', 1, 1, null),
    ('battle_iq','predictive_mastery','Predictive Mastery',    7, 3.10,'peak', 1, 1, 'Membaca dan mengantisipasi langkah lawan'),
    ('battle_iq','precognitive_level','Precognitive Level',    8, 3.50,'peak', 1, 0, 'Mendekati prediksi sempurna')
)
insert into stat_scales (metric_id, scale_code, label, rank, log_value, band, is_rankable, is_physical, notes)
select m.id, v.scale_code, v.label, v.rank, v.log_value, v.band, v.is_rankable, v.is_physical, v.notes
  from v
  join stat_scale_metrics m on m.metric = v.metric
on conflict (metric_id, scale_code) do nothing;

-- Salin skala AP ke durability & striking_strength
insert into stat_scales (metric_id, scale_code, label, rank, log_value, band, is_rankable, is_physical, notes)
select m.id, s.scale_code, s.label, s.rank, s.log_value, s.band, s.is_rankable, s.is_physical, s.notes
  from stat_scales s
  join stat_scale_metrics ap on ap.id = s.metric_id and ap.metric = 'attack_potency'
  join stat_scale_metrics m on m.metric in ('durability', 'striking_strength')
on conflict (metric_id, scale_code) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Tier ladder
-- ---------------------------------------------------------------------------
insert into tiers (tier_code, tier_name, band, display_order, numerical_rank, is_rankable, description)
values
  -- parent/band (non-rankable)
  ('band-11','Tier 11','none',111,null,0,'Band 11: di bawah level manusia biasa'),
  ('band-10','Tier 10','none',110,null,0,'Band 10: level manusia hingga bangunan kecil'),
  ('band-9','Tier 9','none',109,null,0,'Band 9: level dinding hingga gedung'),
  ('band-8','Tier 8','none',108,null,0,'Band 8: level blok kota hingga gunung kecil'),
  ('band-7','Tier 7','none',107,null,0,'Band 7: level kota hingga gunung besar'),
  ('band-6','Tier 6','none',106,null,0,'Band 6: level pulau hingga negara'),
  ('band-5','Tier 5','none',105,null,0,'Band 5: level benua hingga planet'),
  ('band-4','Tier 4','none',104,null,0,'Band 4: level bintang hingga tata surya'),
  ('band-3','Tier 3','none',103,null,0,'Band 3: level galaksi hingga multiversal'),
  ('band-2','Tier 2','none',102,null,0,'Band 2: level multiversal tinggi'),
  ('band-1','Tier 1','none',101,null,0,'Band 1: level di luar kerangka universal'),
  ('band-peak','Peak','none',199,null,0,'Puncak ladder'),
  ('unknown','Unknown','none',200,null,0,'Tidak diketahui; tidak dapat dipakai sebagai input perbandingan'),
  ('varies','Varies','none',201,null,0,'Berubah-ubah; engine menjalankan skenario typical dan best-case'),
  -- leaf (rankable, rank 1..35)
  ('11-C','Tier 11-C','low',    1,    1, 1, 'Below Average Human'),
  ('11-B','Tier 11-B','low',    2,    2, 1, 'Athlete level'),
  ('11-A','Tier 11-A','low',    3,    3, 1, 'Peak Human level'),
  ('10-C','Tier 10-C','low',    4,    4, 1, 'Wall level'),
  ('10-B','Tier 10-B','mid',    5,    5, 1, 'Small Building level'),
  ('10-A','Tier 10-A','mid',    6,    6, 1, 'Building level'),
  ('9-C', 'Tier 9-C', 'low',    7,    7, 1, 'City Block level'),
  ('9-B', 'Tier 9-B', 'mid',    8,    8, 1, 'Multi-City Block level'),
  ('9-A', 'Tier 9-A', 'high',   9,    9, 1, 'Town level'),
  ('8-C', 'Tier 8-C', 'low',   10,   10, 1, 'Small City level'),
  ('8-B', 'Tier 8-B', 'mid',   11,   11, 1, 'City level'),
  ('8-A', 'Tier 8-A', 'high',  12,   12, 1, 'Mountain level'),
  ('7-C', 'Tier 7-C', 'low',   13,   13, 1, 'Large Mountain level'),
  ('7-B', 'Tier 7-B', 'mid',   14,   14, 1, 'Island level'),
  ('7-A', 'Tier 7-A', 'high',  15,   15, 1, 'Large Island level'),
  ('6-C', 'Tier 6-C', 'low',   16,   16, 1, 'Country level'),
  ('6-B', 'Tier 6-B', 'mid',   17,   17, 1, 'Large Country level'),
  ('6-A', 'Tier 6-A', 'high',  18,   18, 1, 'Multi-Continental level'),
  ('5-C', 'Tier 5-C', 'low',   19,   19, 1, 'Moon level'),
  ('5-B', 'Tier 5-B', 'mid',   20,   20, 1, 'Small Planet level'),
  ('5-A', 'Tier 5-A', 'high',  21,   21, 1, 'Planet level'),
  ('4-C', 'Tier 4-C', 'low',   22,   22, 1, 'Dwarf Star level'),
  ('4-B', 'Tier 4-B', 'mid',   23,   23, 1, 'Star level'),
  ('4-A', 'Tier 4-A', 'high',  24,   24, 1, 'Multi-Solar System level'),
  ('3-C', 'Tier 3-C', 'low',   25,   25, 1, 'Galaxy level'),
  ('3-B', 'Tier 3-B', 'mid',   26,   26, 1, 'Multi-Galaxy level'),
  ('3-A', 'Tier 3-A', 'high',  27,   27, 1, 'Universal level'),
  ('2-C', 'Tier 2-C', 'low',   28,   28, 1, 'Low Multiversal level'),
  ('2-B', 'Tier 2-B', 'mid',   29,   29, 1, 'Multiversal level'),
  ('2-A', 'Tier 2-A', 'high',  30,   30, 1, 'High Multiversal level'),
  ('1-C', 'Tier 1-C', 'low',   31,   31, 1, 'Outerversal level'),
  ('1-B', 'Tier 1-B', 'mid',   32,   32, 1, 'Transcendent level'),
  ('1-A', 'Tier 1-A', 'high',  33,   33, 1, 'Boundless-adjacent'),
  ('High 1-A','Tier High 1-A','peak', 34, 34, 1, 'Beyond Outerversal'),
  ('Tier 0','Tier 0','peak',   35,   35, 1, 'Boundless')
on conflict (tier_code) do nothing;

-- Hubungkan leaf ke band parent
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-11') where tier_code like '11-%' and parent_tier_id is null;
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-10') where tier_code like '10-%' and parent_tier_id is null;
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-9')  where tier_code like '9-%' and parent_tier_id is null;
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-8')  where tier_code like '8-%' and parent_tier_id is null;
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-7')  where tier_code like '7-%' and parent_tier_id is null;
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-6')  where tier_code like '6-%' and parent_tier_id is null;
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-5')  where tier_code like '5-%' and parent_tier_id is null;
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-4')  where tier_code like '4-%' and parent_tier_id is null;
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-3')  where tier_code like '3-%' and parent_tier_id is null;
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-2')  where tier_code like '2-%' and parent_tier_id is null;
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-1')  where tier_code like '1-%' and parent_tier_id is null;
update tiers set parent_tier_id = (select id from tiers where tier_code = 'band-peak') where tier_code in ('High 1-A', 'Tier 0') and parent_tier_id is null;

-- ---------------------------------------------------------------------------
-- 5. Kategori ability
-- ---------------------------------------------------------------------------
insert into ability_categories (slug, name, description, is_offensive, is_defensive, is_passive, is_resistible, is_negation)
values
  ('attack-manipulation','Attack Manipulation','Memanipulasi sifat serangan dasar',1,0,0,1,0),
  ('energy-manipulation','Energy Manipulation','Memanipulasi energi (ki, chakra, mana, dst.)',1,0,0,1,0),
  ('elemental-manipulation','Elemental Manipulation','Memanipulasi elemen dasar',1,0,0,1,0),
  ('matter-manipulation','Matter Manipulation','Memanipulasi materi pada tingkat molekul/atom',1,0,0,1,0),
  ('biological-manipulation','Biological Manipulation','Memanipulasi tubuh/biologi target',1,0,0,1,0),
  ('technology-manipulation','Technology Manipulation','Mengendalikan atau merusak teknologi',1,0,0,1,0),
  ('gravity-manipulation','Gravity Manipulation','Mengubah gaya gravitasi',1,0,0,1,0),
  ('magnetism-manipulation','Magnetism Manipulation','Mengendalikan medan magnet',1,0,0,1,0),
  ('light-manipulation','Light Manipulation','Mengendalikan cahaya',1,0,0,1,0),
  ('darkness-manipulation','Darkness Manipulation','Mengendalikan kegelapan',1,0,0,1,0),
  ('sound-manipulation','Sound Manipulation','Mengendalikan gelombang suara',1,0,0,1,0),
  ('weather-manipulation','Weather Manipulation','Mengendalikan cuaca',1,0,0,1,0),
  ('space-manipulation','Space Manipulation','Memanipulasi ruang dan jarak',1,0,0,1,0),
  ('time-manipulation','Time Manipulation','Memanipulasi alur waktu, termasuk time stop',1,0,0,1,0),
  ('causality-manipulation','Causality Manipulation','Memanipulasi hubungan sebab-akibat',1,0,0,1,0),
  ('probability-manipulation','Probability Manipulation','Mengubah peluang terjadinya peristiwa',1,0,0,1,0),
  ('fate-manipulation','Fate Manipulation','Mengubah takdir yang sudah ditetapkan',1,0,0,1,0),
  ('reality-warping','Reality Warping','Mengubah realitas secara langsung',1,0,0,1,0),
  ('law-manipulation','Law Manipulation','Menetapkan atau mengubah hukum alam',1,0,0,1,0),
  ('conceptual-manipulation','Conceptual Manipulation','Memanipulasi konsep abstrak',1,0,0,1,0),
  ('information-manipulation','Information Manipulation','Memanipulasi informasi sebagai objek',1,0,0,1,0),
  ('void-manipulation','Void Manipulation','Memanipulasi kehampaan/nihil',1,0,0,1,0),
  ('mind-manipulation','Mind Manipulation','Mengendalikan atau merusak pikiran',1,0,0,1,0),
  ('empathic-manipulation','Empathic Manipulation','Mengendalikan emosi',1,0,0,1,0),
  ('fear-manipulation','Fear Manipulation','Menimbulkan teror atau rasa takut',1,0,0,1,0),
  ('illusion-creation','Illusion Creation','Menciptakan ilusi persepsi',1,0,0,1,0),
  ('soul-manipulation','Soul Manipulation','Memanipulasi jiwa target',1,0,0,1,0),
  ('curse-manipulation','Curse Manipulation','Memberi kutukan',1,0,0,1,0),
  ('existence-erasure','Existence Erasure','Menghapus keberadaan target',1,0,0,1,1),
  ('durability-negation','Durability Negation','Menyerang tanpa memedulikan daya tahan',1,0,0,1,1),
  ('power-nullification','Power Nullification','Menonaktifkan kemampuan target',1,1,0,1,1),
  ('regeneration-negation','Regeneration Negation','Menghambat atau membalikkan regenerasi',1,0,0,1,1),
  ('immortality-negation','Immortality Negation','Menembus keabadian target',1,0,0,1,1),
  ('absorption','Absorption','Menyerap energi, kemampuan, atau entitas',1,1,0,1,0),
  ('sealing','Sealing','Menyegel target atau kemampuannya',1,1,0,1,0),
  ('bfr','Battlefield Removal','Mengeluarkan target dari medan pertarungan',1,0,0,1,0),
  ('status-effect-inducement','Status Effect Inducement','Menerapkan efek status pelemah',1,0,0,1,0),
  ('statistics-amplification','Statistics Amplification','Meningkatkan statistik diri sendiri',0,1,0,1,0),
  ('statistics-reduction','Statistics Reduction','Menurunkan statistik lawan',1,0,0,1,0),
  ('damage-reduction','Damage Reduction','Mengurangi dampak serangan yang masuk',0,1,0,1,0),
  ('regeneration','Regeneration','Memulihkan tubuh dari luka',0,1,1,1,0),
  ('immortality','Immortality','Tidak dapat mati dengan cara biasa',0,1,1,1,0),
  ('healing','Healing','Menyembuhkan diri atau pihak lain',0,1,1,1,0),
  ('forcefield-creation','Forcefield Creation','Membuat penghalang energi',0,1,0,1,0),
  ('intangibility','Intangibility','Menjadi tak berwujud',0,1,0,1,0),
  ('non-physical-interaction','Non-Physical Interaction','Dapat menyentuh entitas non-fisik',1,0,0,1,0),
  ('invisibility','Invisibility','Menjadi tak terlihat',0,1,0,1,0),
  ('shapeshifting','Shapeshifting','Mengubah bentuk',0,1,0,1,0),
  ('duplication','Duplication','Menciptakan salinan diri',1,0,0,1,0),
  ('adaptation','Adaptation','Menyesuaikan diri terhadap kondisi baru',0,1,1,1,0),
  ('reactive-evolution','Reactive Evolution','Berkembang sebagai respons terhadap ancaman',0,1,1,1,0),
  ('teleportation','Teleportation','Berpindah tempat tanpa melewati jarak',0,1,0,1,0),
  ('dimensional-travel','Dimensional Travel','Berpindah antar dimensi',0,1,0,1,0),
  ('precognition','Precognition','Melihat kejadian sebelum terjadi',0,1,1,1,0),
  ('aura','Aura','Menghasilkan tekanan aura yang berdampak',1,1,1,1,0),
  ('summoning','Summoning','Memanggil entitas pendukung',1,0,0,1,0),
  ('aura-pressure','Aura Pressure','Tekanan aura yang menghambat lawan',1,0,1,1,0)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Tipe resistensi
-- ---------------------------------------------------------------------------
insert into resistance_types (slug, name, category_id, description)
select c.slug || '-resistance',
       'Resistance to ' || c.name,
       c.id,
       'Tingkat penahanan terhadap ' || c.name
  from ability_categories c
 where c.is_resistible
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 7. Aturan interaksi hax
-- ---------------------------------------------------------------------------
with v(ability_slug, resistance_slug, relation, mult, needs_evidence, notes) as (
  values
    ('mind-manipulation',        'mind-manipulation-resistance',        'reduced', 0.40, 0, 'Resistensi mental menurunkan efektivitas, tidak menghapusnya'),
    ('soul-manipulation',        'soul-manipulation-resistance',        'reduced', 0.40, 0, null),
    ('time-manipulation',        'time-manipulation-resistance',        'reduced', 0.35, 1, 'Time stop berkurang durasinya/jangkauannya'),
    ('space-manipulation',       'space-manipulation-resistance',       'reduced', 0.40, 0, null),
    ('existence-erasure',        'existence-erasure-resistance',        'reduced', 0.30, 1, 'Penghapusan eksistensi ditahan sebagian; hanya sah bila bukti tersedia'),
    ('reality-warping',          'reality-warping-resistance',          'reduced', 0.30, 1, null),
    ('causality-manipulation',   'causality-manipulation-resistance',   'reduced', 0.35, 1, null),
    ('probability-manipulation', 'probability-manipulation-resistance', 'reduced', 0.40, 0, null),
    ('conceptual-manipulation',  'conceptual-manipulation-resistance',  'reduced', 0.30, 1, null),
    ('information-manipulation', 'information-manipulation-resistance', 'reduced', 0.35, 1, null),
    ('fate-manipulation',        'fate-manipulation-resistance',        'reduced', 0.35, 1, null),
    ('law-manipulation',         'law-manipulation-resistance',         'reduced', 0.30, 1, null),
    ('void-manipulation',        'void-manipulation-resistance',        'reduced', 0.35, 1, null),
    ('power-nullification',      'power-nullification-resistance',      'reduced', 0.25, 1, 'Nullification tetap bekerja sebagian'),
    ('regeneration-negation',    'regeneration-resistance',             'blocked', 0.00, 1, 'Negasi regenerasi menembus regenerasi; wajib bukti tersumber'),
    ('immortality-negation',     'immortality-resistance',              'blocked', 0.00, 1, 'Negasi keabadian menembus keabadian; wajib bukti tersumber'),
    ('durability-negation',      'durability-negation-resistance',      'reduced', 0.40, 1, null),
    ('matter-manipulation',      'matter-manipulation-resistance',      'reduced', 0.40, 0, null),
    ('biological-manipulation',  'biological-manipulation-resistance',  'reduced', 0.40, 0, null),
    ('fear-manipulation',        'fear-manipulation-resistance',        'reduced', 0.35, 0, null),
    ('empathic-manipulation',    'empathic-manipulation-resistance',    'reduced', 0.35, 0, null),
    ('illusion-creation',        'illusion-creation-resistance',        'reduced', 0.35, 0, null),
    ('precognition',             'precognition-resistance',             'reduced', 0.30, 1, null),
    ('sealing',                  'sealing-resistance',                  'reduced', 0.35, 1, null),
    ('absorption',               'absorption-resistance',               'reduced', 0.40, 0, null),
    ('curse-manipulation',       'curse-manipulation-resistance',       'reduced', 0.40, 0, null),
    ('gravity-manipulation',     'gravity-manipulation-resistance',     'reduced', 0.50, 0, null),
    ('statistics-reduction',     'statistics-reduction-resistance',     'reduced', 0.50, 0, null),
    ('status-effect-inducement', 'status-effect-inducement-resistance', 'reduced', 0.45, 0, null)
)
insert into hax_interactions (ability_category_id, resistance_type_id, relation,
                              effectiveness_multiplier, requires_source_evidence, notes, rule_set_version)
select ab.id, rt.id, v.relation, v.mult, v.needs_evidence, v.notes, '1.0.0'
  from v
  join ability_categories ab on ab.slug = v.ability_slug
  join resistance_types  rt on rt.slug = v.resistance_slug
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 8. Rule set battle default
-- ---------------------------------------------------------------------------
insert into battle_rule_sets (version, engine_version, weights, constants, active, notes)
values (
  '1.0.0',
  'battle-engine@1.0.0',
  '{"tier":12,"attack_potency":13,"durability":10,"speed":12,"reaction_speed":5,"combat_speed":5,"range":4,"stamina":5,"intelligence":4,"battle_iq":6,"experience":3,"abilities":6,"hax":10,"resistances":5}',
  '{"logistic_k":2.2,"normalization_spans":{"tier":8,"attack_potency":10,"durability":10,"striking_strength":10,"lifting_strength":10,"speed":10,"reaction_speed":8,"combat_speed":8,"range":8,"stamina":2,"intelligence":2,"battle_iq":2,"experience":4},"dominance_gate":{"enabled":true,"tier_delta":8,"durability_delta":6,"speed_delta":8,"min_probability":0.95,"requires_no_relevant_resistance":true},"decisive_edge":{"enabled":true,"min_effectiveness":0.55,"single_edge_probability_floor":0.9,"mutual_edge_probability_clamp":[0.35,0.65]},"qualifier_penalty":{"at_least":0.1,"at_most":0.1,"possibly":0.25,"likely":0.15,"up_to":0.15,"higher_with":0.1,"far_higher_with":0.1,"varies":0.3,"unknown":0.4,"exact":0.0},"confidence":{"base":1.0,"per_missing_metric":0.08,"per_missing_ability_data":0.05,"qualifier_heavy_threshold":3,"qualifier_heavy_penalty":0.05,"per_unresolved_conflict":0.1,"floor":0.25,"low_confidence_banner_threshold":0.45},"difficulty_thresholds":{"low":0.45,"mid":0.28,"high":0.12},"condition_modifiers":{"equal_speed_zeroes_speed_metric":true,"in_character_activation_penalty":0.35,"bloodlusted_hax_multiplier":1.2,"random_encounter_battle_iq_multiplier":1.2,"knowledge_full_counter_multiplier":1.25,"knowledge_none_counter_multiplier":0.8,"prep_time_extended_bonus":0.15},"win_condition_map":{"_default":["ko","death","incapacitation","any"],"time-manipulation":["incapacitation","ko","bfr","any"],"mind-manipulation":["incapacitation","submission","ko","any"],"empathic-manipulation":["incapacitation","submission","any"],"fear-manipulation":["incapacitation","submission","any"],"illusion-creation":["incapacitation","submission","any"],"status-effect-inducement":["incapacitation","ko","any"],"statistics-reduction":["incapacitation","any"],"soul-manipulation":["death","incapacitation","any"],"bfr":["bfr","any"],"sealing":["bfr","incapacitation","any"],"regeneration-negation":["death","any"],"immortality-negation":["death","any"],"power-nullification":["incapacitation","ko","any"],"absorption":["incapacitation","ko","death","any"],"precognition":[],"teleportation":[],"regeneration":[],"immortality":[],"healing":[],"forcefield-creation":[],"intangibility":[],"invisibility":[],"shapeshifting":[],"adaptation":[],"reactive-evolution":[],"duplication":[],"summoning":[],"aura":[],"aura-pressure":[],"non-physical-interaction":[],"statistics-amplification":[],"damage-reduction":[],"dimensional-travel":[]}}',
  1,
  'Rule set default MVP: layered decision + weighted scoring, deterministik.'
)
on conflict (version) do nothing;
