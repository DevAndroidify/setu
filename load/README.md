# Load tests (k6)

Two scripts, run with the k6 Docker image against a locally running API and worker:

- `import.js`: one production run of a generated file through the API (upload, mapping,
  submit, approve, start) until it completes. Reports seconds and rows per second.
- `api.js`: 20 virtual users searching persons and opening records for a minute. Reports
  requests per second and p95 latency; fails if p95 is over 500 ms or more than 1% fail.

Results are written to `load/results/<script>-<label>.json`.

## Running them

Use a separate database, Redis database and bucket so the numbers start from an empty target:

```bash
npm run build
npm run generate:data -- --rows 100000 --seed 100 --out load/data/register-100k

export DATABASE_URL=postgresql://setu:setu_dev_password@localhost:5432/setu_load
export REDIS_URL=redis://localhost:6379/1 S3_BUCKET=setu-load LOG_LEVEL=warn
docker compose exec postgres psql -U setu -d setu -c 'CREATE DATABASE setu_load'
npx prisma migrate deploy && node --env-file=.env dist/prisma/seed.js

node --env-file=.env dist/apps/api/main.js &
node --env-file=.env dist/apps/worker/main.js &

k6() { docker run --rm --user "$(id -u):$(id -g)" --network host -v "$PWD:/work" -w /work \
  -e SETU_PASSWORD="$SEED_PASSWORD" -e LABEL="$1" grafana/k6:1.3.0 run --quiet "load/$2"; }
k6 baseline import.js
k6 baseline api.js
```

`--network host` lets the container reach the API on localhost (Linux and WSL Docker engines).
Per-stage batch timings are on the worker's metrics endpoint
(`curl localhost:9464/metrics | grep setu_batch_duration_seconds`).
