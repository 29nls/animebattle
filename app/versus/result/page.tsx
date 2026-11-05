import type { Metadata } from 'next';

import { loadBattleResult } from '@/features/battle/queries.ts';
import { parseBattleConditionsFromQuery } from '@/features/battle/conditions.ts';
import { defaultRuleSet } from '@/features/battle/rule-set.ts';
import { attemptLoad } from '@/features/data-source.ts';
import { isAdminAuthenticated } from '@/features/admin/session.ts';
import { DatabaseUnavailable } from '@/components/database-unavailable.tsx';
import { BattleResultView } from '@/components/battle-result-view.tsx';
import { DEMO_LABEL, DEMO_NOTICE } from '@/features/demo/provider.ts';

export const metadata: Metadata = {
  title: 'Battle Result',
  description: 'Hasil simulasi engine pertarungan.',
  alternates: { canonical: '/versus/result' },
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function VersusResultPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

  const valueA = (single(params.form_a) ?? single(params.char_a) ?? '').trim();
  const valueB = (single(params.form_b) ?? single(params.char_b) ?? '').trim();

  // Sumber data dipilih di `features/battle/queries.ts`: database dulu
  // (`battle_dataset`), dataset demo hanya bila database belum dikonfigurasi.
  // Pilihan yang tidak sah datang sebagai `invalid` yang pesannya sudah jadi;
  // galat infrastruktur lewat `attemptLoad` sehingga halaman menjawab panel
  // jujur, bukan 500.
  const outcome = await attemptLoad(() =>
    loadBattleResult({
      valueA,
      valueB,
      conditions: parseBattleConditionsFromQuery(params),
      rule_set: defaultRuleSet(),
    }),
  );

  if (outcome.status === 'failed') {
    return (
      <div className="animate-fade-in mx-auto max-w-2xl">
        <DatabaseUnavailable
          detail={outcome.message}
          viewerIsOperator={await isAdminAuthenticated()}
        />
      </div>
    );
  }

  if (outcome.data.status === 'invalid') {
    return (
      <div className="animate-fade-in mx-auto max-w-2xl">
        <div className="rounded-2xl border border-accent-flag/30 bg-accent-flag/10 p-6 text-sm">
          <h1 className="text-lg font-bold text-ink-0">Simulasi belum dapat dijalankan</h1>
          <p className="mt-2 leading-relaxed text-ink-1">{outcome.data.message}</p>
          <a href="/versus" className="btn-primary mt-6 inline-flex text-sm px-6">
            Kembali ke Battle Builder
          </a>
        </div>
      </div>
    );
  }

  const { result, sideA, sideB, source } = outcome.data.bundle;

  return (
    <BattleResultView
      result={result}
      sideA={sideA}
      sideB={sideB}
      demoSource={source === 'demo'}
      demoLabel={DEMO_LABEL}
      demoNotice={DEMO_NOTICE}
      footer={
        <a href="/versus" className="btn-primary text-xs !py-2 !px-4">
          Simulasi lain
        </a>
      }
    />
  );
}
