import { PageSkeleton } from '@/components/page-skeleton.tsx';

/** Keadaan memuat untuk seluruh segmen di bawah layout akar. */
export default function Loading() {
  return <PageSkeleton label="Memuat halaman…" />;
}
