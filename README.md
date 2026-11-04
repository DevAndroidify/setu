# Setu

Setu moves records from legacy Nepal government systems into a modern database, with proof at every
step: profiling, validation, quarantine with reasons, duplicate matching, lineage, reconciliation
reports and a tamper-evident audit log. Production loads need a second person's approval, and every
run can be rolled back. All data in this repository is synthetic.

Built with NestJS, TypeScript, PostgreSQL, Redis (BullMQ) and MinIO. The officer web app is
[setu-frontend](https://github.com/DevAndroidify/setu-frontend).

## Run it

Needs Node 22 and Docker.

```bash
cp .env.example .env
npm ci
docker compose up -d --wait
npm run db:deploy && npm run db:seed
npm run start:api      # http://localhost:3000
npm run start:worker
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/adr](docs/adr).
