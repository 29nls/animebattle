'use client';

import { useState } from 'react';

import type { LegalReportKind } from '@/features/legal/takedown.ts';

type State =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; ticket: string }
  | { status: 'error'; message: string };

export function TakedownForm({ kind = 'takedown' }: { kind?: LegalReportKind }) {
  const [state, setState] = useState<State>({ status: 'idle' });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status === 'submitting') return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setState({ status: 'submitting' });

    try {
      const response = await fetch('/api/legal/takedown', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind,
          name: data.get('name'),
          email: data.get('email'),
          url: data.get('url'),
          description: data.get('description'),
          good_faith: data.get('good_faith') === 'on',
          website: data.get('website'),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: { ticket_code?: string }; error?: { message?: string } }
        | null;

      if (response.status === 201 && payload?.data?.ticket_code) {
        form.reset();
        setState({ status: 'success', ticket: payload.data.ticket_code });
        return;
      }
      setState({
        status: 'error',
        message: payload?.error?.message ?? 'Laporan tidak dapat dikirim. Coba lagi nanti.',
      });
    } catch {
      setState({ status: 'error', message: 'Jaringan tidak tersedia. Coba lagi setelah terhubung.' });
    }
  }

  if (state.status === 'success') {
    return (
      <div role="status" className="rounded-xl border border-accent-win/30 bg-accent-win/10 p-5">
        <h2 className="text-lg font-bold text-ink-0">Laporan diterima</h2>
        <p className="mt-2 text-sm text-ink-2">
          Simpan kode tiket berikut. Kode ini adalah satu-satunya cara operator mencocokkan laporan
          Anda; jangan bagikan kepada pihak yang tidak berkepentingan.
        </p>
        <p className="mt-3 rounded-lg bg-surface-1 px-3 py-2 font-mono text-lg font-bold text-ink-0">
          {state.ticket}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      <input type="hidden" name="kind" value={kind} />
      <div className="absolute left-[-9999px]" aria-hidden="true">
        <label>
          Website (jangan diisi)
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="legal-name" className="mb-1 block text-sm font-medium text-ink-1">
            Nama Anda atau organisasi <span aria-hidden="true">*</span>
          </label>
          <input
            id="legal-name"
            name="name"
            required
            minLength={2}
            maxLength={120}
            autoComplete="name"
            className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-ink-0 outline-none focus:border-accent-b"
          />
        </div>
        <div>
          <label htmlFor="legal-email" className="mb-1 block text-sm font-medium text-ink-1">
            Surel yang dapat dihubungi <span aria-hidden="true">*</span>
          </label>
          <input
            id="legal-email"
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-ink-0 outline-none focus:border-accent-b"
          />
        </div>
      </div>

      <div>
        <label htmlFor="legal-url" className="mb-1 block text-sm font-medium text-ink-1">
          URL halaman atau data yang dilaporkan <span aria-hidden="true">*</span>
        </label>
        <input
          id="legal-url"
          name="url"
          type="url"
          required
          maxLength={2048}
          placeholder="https://…"
          className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-ink-0 outline-none focus:border-accent-b"
        />
      </div>

      <div>
        <label htmlFor="legal-description" className="mb-1 block text-sm font-medium text-ink-1">
          Deskripsi pelanggaran dan hak yang Anda miliki <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="legal-description"
          name="description"
          required
          minLength={20}
          maxLength={5000}
          rows={6}
          className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-ink-0 outline-none focus:border-accent-b"
        />
        <p className="mt-1 text-xs text-ink-3">
          Jangan kirim kata sandi, token, atau dokumen identitas. Bukti kepemilikan dapat diminta
          melalui surel setelah tiket dibuat.
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm text-ink-2">
        <input type="checkbox" name="good_faith" required className="mt-1" />
        <span>
          Saya menyatakan informasi ini akurat dan saya berwenang bertindak atas nama pemegang hak
          atau data yang bersangkutan. <span aria-hidden="true">*</span>
        </span>
      </label>

      {state.status === 'error' ? (
        <p role="alert" className="rounded-lg border border-accent-lose/30 bg-accent-lose/10 p-3 text-sm text-accent-lose">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={state.status === 'submitting'}
        className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state.status === 'submitting' ? 'Mengirim…' : 'Kirim laporan'}
      </button>
      <p className="text-xs text-ink-3">
        Dengan mengirim laporan, Anda menyetujui pemrosesan data sesuai{' '}
        <a href="/legal/privacy" className="text-accent-b underline underline-offset-2">
          kebijakan privasi
        </a>
        .
      </p>
    </form>
  );
}
