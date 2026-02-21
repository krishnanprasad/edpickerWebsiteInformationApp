# SchoolLens Implementation Baseline

This repository now implements the requested components:

- **Monorepo**: Nx workspace with `apps/web`, `apps/api`, `apps/crawler`
- **Frontend**: Angular 17 + Angular Material + Universal server entry (`apps/web`)
- **Crawler**: Node.js 20 + **Crawlee + Playwright** (`apps/crawler/src/worker.ts`)
- **Queue**: **BullMQ** over Redis for crawl and scoring jobs (`src/server.ts`, `apps/crawler/src/worker.ts`)
- **File Storage**: **MinIO/S3 or Azure Blob** abstraction (`src/storage.ts`)

It also includes:
- TypeScript API (`src/server.ts`)
- PostgreSQL schema (`sql/schema.sql`)
- Redis cache + queue
- Optional OpenAI (key can be added later via env)

## Nx monorepo usage
- `nx run web:dev`
- `nx run crawler:dev`
- `nx run api:dev`
- `nx graph`

Project configs:
- `apps/web/project.json`
- `apps/crawler/project.json`
- `apps/api/project.json`

## Monorepo layout
- `apps/web` Angular app (scan + ask same page UI)
- `apps/api` API project metadata + .NET API variant in `apps/api/SchoolLens.Api`
- `apps/crawler` BullMQ workers + Crawlee/Playwright crawler
- `src` TypeScript API + storage service
- `sql` database schema
- `infra/docker` container files

## Quick start (local)
1. Copy env:
```bash
cp .env.example .env
```

2. Start infrastructure and services:
```bash
docker compose up --build
```

3. Open app:
- API + static UI: `http://localhost:3000`
- MinIO console: `http://localhost:9001`

## OpenAI key later
You can implement now and set key later:
```env
OPENAI_API_KEY=
OPENAI_MODEL_CHAT=gpt-4o
OPENAI_MODEL_SCORING=gpt-4o-mini
```
Without key, deterministic fallback still answers.

## Storage mode
- S3/MinIO mode (default): set `STORAGE_PROVIDER=s3`
- Azure Blob mode: set `STORAGE_PROVIDER=azure` and `AZURE_STORAGE_CONNECTION_STRING`
