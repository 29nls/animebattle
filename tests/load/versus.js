import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3315';
const VERSUS_PATH = __ENV.VERSUS_PATH;

if (!VERSUS_PATH) {
  throw new Error('VERSUS_PATH wajib diisi');
}

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || '20s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
};

export default function () {
  const response = http.get(`${BASE_URL}${VERSUS_PATH}`, {
    tags: { endpoint: 'versus' },
  });
  check(response, {
    'versus 200': (res) => res.status === 200,
    'versus merender halaman': (res) => res.body.includes('vs'),
  });
  sleep(1);
}
