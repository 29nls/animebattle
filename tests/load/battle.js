import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3315';
const VERSION_A = __ENV.VERSION_A;
const VERSION_B = __ENV.VERSION_B;

if (!VERSION_A || !VERSION_B) {
  throw new Error('VERSION_A dan VERSION_B wajib diisi');
}

export const options = {
  vus: Number(__ENV.VUS || 3),
  duration: __ENV.DURATION || '20s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
};

export default function () {
  const payload = JSON.stringify({
    side_a_version_id: VERSION_A,
    side_b_version_id: VERSION_B,
  });
  const response = http.post(`${BASE_URL}/api/battle/simulate`, payload, {
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `203.0.114.${__VU}`,
    },
    tags: { endpoint: 'battle-simulate' },
  });
  check(response, {
    'simulate 200': (res) => res.status === 200,
    'simulate punya pemenang': (res) => {
      try {
        return typeof res.json('winner') === 'string';
      } catch {
        return false;
      }
    },
  });
  sleep(1);
}
