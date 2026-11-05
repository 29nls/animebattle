'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import type { PickerFormOption, PickerSelection } from '@/features/battle/picker-queries.ts';

interface Suggestion {
  slug: string;
  name: string;
  verse_name: string;
}

interface Props {
  /** `form_a` atau `form_b` — nama field yang dibaca `/versus/result`. */
  name: string;
  side: 'A' | 'B';
  /** Label awal dari URL (server sudah memvalidasinya). */
  initial: PickerSelection | null;
  /** Nilai awal dataset demo; combobox memakai daftar ini alih-alih API. */
  demoOptions: PickerSelection[] | null;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

/**
 * Combobox karakter + form untuk `/versus`.
 *
 * Kenapa bukan `<select>` berisi seluruh katalog: halaman harus mengangkut setiap
 * karakter dan form sebelum pengguna dapat memilih apa pun. Combobox memanggil
 * `/api/search/suggest` (maks 8 saran) lalu `/api/characters/:slug/versions`
 * untuk form karakter terpilih, sehingga biaya per permintaan tidak tumbuh
 * mengikuti ukuran katalog.
 *
 * Nilai yang dikirim tetap `form_a`/`form_b` berformat `karakter/form` — bentuk
 * yang sama dengan tautan masuk `/character/[slug]` dan `/compare`, dan yang
 * dibaca `/versus/result`. Jadi penggantian komponen ini tidak mengubah kontrak
 * URL mana pun.
 *
 * Aksesibilitas mengikuti pola combobox WAI-ARIA: `role="combobox"` dengan
 * `aria-expanded`/`aria-controls`/`aria-activedescendant`, navigasi panah,
 * Enter memilih, Escape menutup. Tanpa JavaScript, input tetap dapat dikirim
 * bila nilainya sudah lengkap (ada input tersembunyi yang menampung nilai).
 */
export function FighterPicker({ name, side, initial, demoOptions }: Props) {
  const listId = useId();
  const inputId = useId();

  const [query, setQuery] = useState(initial?.label ?? '');
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [forms, setForms] = useState<PickerFormOption[] | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<string | null>(null);
  const [selectedForm, setSelectedForm] = useState<string>(initial?.value ?? '');
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Saran hanya diminta untuk kueri yang cukup panjang, dengan debounce supaya
  // setiap ketikan tidak menjadi satu permintaan.
  useEffect(() => {
    if (demoOptions) return;
    const trimmed = query.trim();
    // Label yang sudah terpilih jangan memicu pencarian ulang saat fokus.
    if (trimmed.length < MIN_QUERY_LENGTH || selectedForm !== '' && initial?.label === query) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus('loading');
      try {
        const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { data?: Suggestion[] };
        setSuggestions(Array.isArray(body.data) ? body.data : []);
        setStatus('idle');
      } catch (error) {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setStatus('error');
        console.error('[versus] saran pencarian gagal:', error);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, demoOptions, selectedForm, initial?.label]);

  // Menutup daftar saat klik di luar, tanpa memasang listener global permanen.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  async function pickCharacter(slug: string, label: string) {
    setSelectedCharacter(slug);
    setQuery(label);
    setOpen(false);

    if (demoOptions) {
      const first = demoOptions.find((option) => option.value.startsWith(`${slug}/`));
      setSelectedForm(first?.value ?? '');
      return;
    }

    setStatus('loading');
    try {
      const response = await fetch(`/api/characters/${encodeURIComponent(slug)}/versions`, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { data?: PickerFormOption[] };
      const options = Array.isArray(body.data) ? body.data : [];
      setForms(options);
      // Satu form → langsung terpilih; lebih dari satu → pengguna memilih, karena
      // menebak form default dapat mengubah hasil tanpa disadari.
      setSelectedForm(options.length === 1 ? (options[0]?.value ?? '') : '');
      setStatus('idle');
    } catch (error) {
      setForms([]);
      setSelectedForm('');
      setStatus('error');
      console.error('[versus] daftar form gagal dimuat:', error);
    }
  }

  // Sisi yang sama dua kali tidak disaring di sini: `loadBattleResult` sudah
  // menolaknya dengan pesan yang jelas, dan menyembunyikan saran membuat
  // pengguna mengira karakternya tidak ada.
  const visibleSuggestions = suggestions;

  const demoMatches = useMemo(() => {
    if (!demoOptions) return [];
    const needle = query.trim().toLowerCase();
    if (needle === '') return [];
    return demoOptions
      .filter((option) => option.label.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [demoOptions, query]);

  const demoForms = useMemo(() => {
    if (!demoOptions || !selectedCharacter) return [];
    return demoOptions.filter((option) => option.value.startsWith(`${selectedCharacter}/`));
  }, [demoOptions, selectedCharacter]);

  const showList = open && (demoOptions ? demoMatches.length > 0 : visibleSuggestions.length > 0);

  return (
    <div className="space-y-4" ref={containerRef}>
      {/* Nilai yang benar-benar dikirim form; combobox hanya tampilan. */}
      <input type="hidden" name={name} value={selectedForm} />

      <div>
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3"
        >
          Character &amp; Form
        </label>

        <div className="relative">
          <input
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              showList ? `${listId}-option-${active}` : undefined
            }
            autoComplete="off"
            className="input-field"
            placeholder={side === 'A' ? 'Cari karakter A…' : 'Cari karakter B…'}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActive(0);
              setSelectedCharacter(null);
              setSelectedForm('');
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              const count = demoOptions ? demoMatches.length : visibleSuggestions.length;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setOpen(true);
                setActive((current) => (count === 0 ? 0 : (current + 1) % count));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((current) => (count === 0 ? 0 : (current - 1 + count) % count));
              } else if (event.key === 'Enter') {
                // Enter memilih saran, bukan mengirim form setengah jadi.
                if (showList && count > 0) {
                  event.preventDefault();
                  if (demoOptions) {
                    const option = demoMatches[active];
                    if (option) {
                      const [slug] = option.value.split('/');
                      void pickCharacter(slug ?? '', option.label.split(' — ')[0] ?? option.label);
                      setSelectedForm(option.value);
                    }
                  } else {
                    const suggestion = visibleSuggestions[active];
                    if (suggestion) void pickCharacter(suggestion.slug, suggestion.name);
                  }
                }
              } else if (event.key === 'Escape') {
                setOpen(false);
              }
            }}
          />

          {showList && (
            <ul
              id={listId}
              role="listbox"
              className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line-strong bg-surface-1 py-1 shadow-card"
            >
              {demoOptions
                ? demoMatches.map((option, index) => (
                    <li
                      key={option.value}
                      id={`${listId}-option-${index}`}
                      role="option"
                      aria-selected={index === active}
                      className={`cursor-pointer px-3 py-2 text-sm ${index === active ? 'bg-surface-2 text-ink-0' : 'text-ink-1'}`}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        const [slug] = option.value.split('/');
                        void pickCharacter(slug ?? '', option.label.split(' — ')[0] ?? option.label);
                        setSelectedForm(option.value);
                      }}
                    >
                      {option.label}
                    </li>
                  ))
                : visibleSuggestions.map((suggestion, index) => (
                    <li
                      key={suggestion.slug}
                      id={`${listId}-option-${index}`}
                      role="option"
                      aria-selected={index === active}
                      className={`cursor-pointer px-3 py-2 text-sm ${index === active ? 'bg-surface-2 text-ink-0' : 'text-ink-1'}`}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        void pickCharacter(suggestion.slug, suggestion.name);
                      }}
                    >
                      <span className="font-medium">{suggestion.name}</span>
                      <span className="ml-2 text-xs text-ink-3">{suggestion.verse_name}</span>
                    </li>
                  ))}
            </ul>
          )}
        </div>

        {status === 'loading' && <p className="mt-1 text-xs text-ink-3">Memuat…</p>}
        {status === 'error' && (
          <p className="mt-1 text-xs text-accent-flag">
            Saran tidak dapat dimuat. Periksa koneksi lalu coba lagi.
          </p>
        )}
      </div>

      {selectedCharacter && (
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-3">
            Form
          </label>
          <select
            className="input-field"
            value={selectedForm}
            onChange={(event) => setSelectedForm(event.target.value)}
            required
          >
            <option value="" disabled>
              Pilih form…
            </option>
            {(demoOptions ? demoForms : (forms ?? [])).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-ink-3">
            Statistik melekat pada form/era, bukan pada karakter secara umum.
          </p>
        </div>
      )}

      {!selectedCharacter && selectedForm !== '' && (
        <p className="text-xs text-ink-2">
          Form terpilih dari tautan:{' '}
          <span className="font-mono text-ink-1">{selectedForm}</span>
        </p>
      )}
    </div>
  );
}
