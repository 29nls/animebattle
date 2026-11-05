'use client';

import { useEffect, useState } from 'react';

/**
 * Pemberitahuan offline.
 *
 * Status jaringan hanya diketahui browser, jadi komponen ini kecil dan sengaja
 * tidak melakukan fetch. Ia tidak mencoba menyembunyikan halaman yang sudah
 * dirender server — halaman tetap dapat dibaca — tetapi memberi tahu bahwa
 * pencarian, saran karakter, dan simulasi memerlukan koneksi.
 *
 * Server merender `false` (banner tidak ada), lalu efek menyamakan dengan
 * `navigator.onLine`. Urutan itu menghindari hydration mismatch: HTML awal dan
 * render klien pertama identik.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-accent-flag/30 bg-accent-flag/10 px-4 py-2 text-center text-xs text-accent-flag"
    >
      Anda sedang offline. Halaman yang sudah dimuat tetap dapat dibaca; pencarian dan simulasi
      memerlukan koneksi internet.
    </div>
  );
}
