// API latency under load: officers searching and opening records while nothing else runs.
//
//   docker run --rm --network host -v "$PWD:/work" -w /work \
//     -e SETU_PASSWORD=... grafana/k6:1.3.0 run load/api.js
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.SETU_URL || 'http://localhost:3000';
const API = `${BASE}/api/v1`;
const LABEL = __ENV.LABEL || 'run';

// Synthetic surnames from the generator: common, so searches return full pages.
const TERMS = ['thapa', 'magar', 'shah', 'khanal', 'baral', 'sita', 'ram', 'gita'];

export const options = {
  scenarios: {
    officers: {
      executor: 'ramping-vus',
      stages: [
        { duration: '10s', target: 20 },
        { duration: '40s', target: 20 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration{name:search}': ['p(95)<500'],
    'http_req_duration{name:person}': ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const res = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: 'operator@setu.local', password: __ENV.SETU_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const token = res.json('accessToken');
  const page = http.get(`${API}/persons?limit=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { token, ids: page.json('data').map((p) => p.id) };
}

export default function ({ token, ids }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const term = TERMS[Math.floor(Math.random() * TERMS.length)];
  const search = http.get(`${API}/persons?q=${term}&limit=50`, {
    ...auth,
    tags: { name: 'search' },
  });
  check(search, { 'search 200': (r) => r.status === 200 });
  const id = ids[Math.floor(Math.random() * ids.length)];
  const one = http.get(`${API}/persons/${id}?calendar=bs`, { ...auth, tags: { name: 'person' } });
  check(one, { 'person 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const p = (name) => data.metrics[`http_req_duration{name:${name}}`]?.values;
  const out = {
    label: LABEL,
    requests: data.metrics.http_reqs.values.count,
    requestsPerSecond: data.metrics.http_reqs.values.rate,
    searchP95ms: p('search')?.['p(95)'],
    personP95ms: p('person')?.['p(95)'],
    failed: data.metrics.http_req_failed.values.rate,
  };
  return {
    stdout: `${JSON.stringify(out, null, 2)}\n`,
    [`/work/load/results/api-${LABEL}.json`]: JSON.stringify(out, null, 2),
  };
}
