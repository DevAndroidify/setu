// Import throughput: one production run of a generated legacy file, end to end through the
// API (upload, mapping, submit, approve, start) until the run completes.
//
//   npm run generate:data -- --rows 100000 --seed 100 --out load/data/register-100k
//   docker run --rm --network host -v "$PWD:/work" -w /work \
//     -e SETU_PASSWORD=... grafana/k6:1.3.0 run load/import.js
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.SETU_URL || 'http://localhost:3000';
const API = `${BASE}/api/v1`;
const FILE = __ENV.FILE || 'load/data/register-100k.cp1252.csv';
const LABEL = __ENV.LABEL || 'run';
const file = open(`/work/${FILE}`, 'b');
const mapping = open('/work/test/fixtures/mappings/household-register.v1.json');

const importSeconds = new Trend('setu_import_seconds');
const rowsPerSecond = new Trend('setu_import_rows_per_second');

export const options = {
  scenarios: {
    import: { executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '60m' },
  },
};

function login(role) {
  const res = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: `${role}@setu.local`, password: __ENV.SETU_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (res.status !== 200) fail(`login ${role}: ${res.status}`);
  return {
    headers: {
      Authorization: `Bearer ${res.json('accessToken')}`,
      'Content-Type': 'application/json',
    },
  };
}

function post(path, body, auth, expected) {
  const res = http.post(`${API}${path}`, body === undefined ? '{}' : JSON.stringify(body), auth);
  if (res.status !== expected) fail(`POST ${path}: ${res.status} ${res.body}`);
  return res.json();
}

export default function () {
  const operator = login('operator');
  const approver = login('approver');

  const source = post(
    '/sources',
    { name: `Load test ${LABEL}`, kind: 'csv', agency: 'Synthetic' },
    operator,
    201,
  );
  const upload = http.post(
    `${API}/sources/${source.id}/files`,
    { file: http.file(file, 'register.csv', 'text/csv') },
    { headers: { Authorization: operator.headers.Authorization } },
  );
  if (upload.status !== 202) fail(`upload: ${upload.status} ${upload.body}`);
  const saved = http.post(`${API}/sources/${source.id}/mappings`, mapping, operator);
  if (saved.status !== 201) fail(`mapping: ${saved.status} ${saved.body}`);

  const run = post(
    '/runs',
    { sourceFileId: upload.json('id'), mappingId: saved.json('id'), mode: 'production' },
    operator,
    201,
  );
  post(`/runs/${run.id}/submit`, undefined, operator, 200);
  post(`/runs/${run.id}/approve`, { decision: 'approved', reason: 'Load test' }, approver, 200);

  const started = Date.now();
  post(`/runs/${run.id}/start`, undefined, operator, 202);
  let status;
  for (;;) {
    sleep(2);
    status = http.get(`${API}/runs/${run.id}`, operator).json();
    if (['completed', 'failed', 'cancelled'].includes(status.status)) break;
  }
  const seconds = (Date.now() - started) / 1000;
  check(status, { 'run completed': (s) => s.status === 'completed' });
  importSeconds.add(seconds);
  rowsPerSecond.add(status.counts.total / seconds);
  console.log(
    `run ${run.id}: ${status.status}, ${JSON.stringify(status.counts)} in ${seconds.toFixed(1)} s`,
  );
}

export function handleSummary(data) {
  const out = {
    label: LABEL,
    file: FILE,
    importSeconds: data.metrics.setu_import_seconds?.values.max,
    rowsPerSecond: data.metrics.setu_import_rows_per_second?.values.max,
  };
  return {
    stdout: `${JSON.stringify(out, null, 2)}\n`,
    [`/work/load/results/import-${LABEL}.json`]: JSON.stringify(out, null, 2),
  };
}
