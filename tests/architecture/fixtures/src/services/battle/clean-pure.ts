// Fixture: BENAR. Engine boleh mengimpor relatif di dalam zonanya dan createHash.
import { createHash } from 'node:crypto';

import type { SideData } from './types.ts';
import { clamp } from './metrics.ts';

export function fingerprint(side: SideData): string {
  return createHash('sha256')
    .update(JSON.stringify([side.version_id, clamp(1, -1, 1)]))
    .digest('hex');
}
