import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3315';

export const options = {
  vus: Number(__ENV.VUS || 3),
  duration: __ENV.DURATION || '20s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
};

export default function () {
  // IP berbeda per VU agar pembatas 60/menit mengukur laju, bukan kuota bersama.
  const response = http.get(`${BASE_URL}/api/search?q=genos`, {
    headers: { 'x-forwarded-for': `203.0.113.${__VU}` },
    tags: { endpoint: 'search' },
  });
  check(response, {
    'search 200': (res) => res.status === 200,
    'search punya data': (res) => {
      try {
        return Array.isArray(res.json('data'));
      } catch {
        return false;
      }
    },
  });
  sleep(0.8);
}
