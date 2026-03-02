# SchoolLens

School website transparency scanner — crawl, classify, and score educational institution websites for safety & decision clarity.

## Features

### B2C Features (v2)
1. **Pre-scan Classification** — Detects if a URL is an educational institution before crawling (15 keyword check, ≥60 % confidence threshold).
2. **Safety & Transparency Score** — 0-100 score across 5 checklist items: Fire Safety Certificate, Sanitary Certificate, CCTV/Security, Transport Safety, Anti-Bullying Policy. Color-coded badges (🟢 ≥80, 🟡 ≥50, 🔴 <50).
3. **Parent Clarity Index** — 0-100 "Decision Clarity Level" measuring 5 factors: Admission Dates, Fee Structure, Academic Calendar, Contact & Map, Results/Outcomes.
4. **Crawl Transparency** — Shows pages/PDFs/images scanned, crawl depth, scan time, and confidence level.
5. **B2B CTA Hook** — "School can verify & improve this score" call-to-action tracking.

### Architecture
- **3-stage pipeline**: Classify → Crawl → Score (BullMQ queues)
- **OpenAI extraction** (gpt-4o-mini) with keyword fallback for offline resilience
- **Dual API**: TypeScript Express + .NET 8 Minimal API
- **Angular 17** multi-step UI with state machine orchestration

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Angular 17 + Angular Material |
| TS API | Express 4 + BullMQ + OpenAI SDK |
| .NET API | ASP.NET 8 Minimal API + Npgsql |
| Crawler | Crawlee + Playwright |
| Queue | BullMQ over Redis 7 |
| Database | PostgreSQL 16 |
| Storage | MinIO / S3 / Azure Blob |

## Monorepo Layout

```
apps/web/          Angular 17 app (multi-step scan UI)
apps/api/          API project metadata + .NET 8 variant
apps/crawler/      BullMQ workers (classify, crawl, score)
src/               TypeScript Express API + storage service
sql/               Schema + migration files
infra/docker/      Container files
```

## Quick Start

### 1. Copy env
```bash
cp .env.example .env
# Edit .env — set OPENAI_API_KEY for AI scoring (optional)
```

### 2. Start everything
```bash
docker compose up --build
```

### 3. Run migration (existing databases)
If the database already has the base schema, apply the migrations manually:
```bash
psql $DATABASE_URL -f sql/migrations/001_scoring_v2.sql
psql $DATABASE_URL -f sql/migrations/002_early_identity.sql
psql $DATABASE_URL -f sql/migrations/003_crawler_v2.sql
psql $DATABASE_URL -f sql/migrations/004_compare_lists.sql
```
New databases auto-apply schema + migrations via Docker init scripts.

### 4. Open
- **Angular app**: `http://localhost:4200` (via `nx run web:dev`)
- **API + static UI**: `http://localhost:3000`
- **MinIO console**: `http://localhost:9001`

## Nx Commands
```bash
nx run web:dev        # Angular dev server
nx run crawler:dev    # Crawler workers
nx run api:dev        # .NET API
nx graph              # Dependency graph
```

## API Endpoints

### Core Scan Pipeline
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scan` | Submit URL → starts classify pipeline |
| GET | `/api/scan/:id` | Full status + scores + crawl summary |
| POST | `/api/scan/:id/ask` | Q&A about scanned content |

### Internal (worker callbacks)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/internal/classify-result` | Classification result from worker |
| POST | `/internal/crawl-result` | Crawl stats from worker |
| POST | `/internal/score-complete` | Safety + clarity scores |

### B2B
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/b2b-interest` | Track CTA clicks |

## Environment Variables

### Env presets
- Use `.env.local` (copy from `.env.local.example`) for local dev with Redis on `localhost:6379`.
- Use `.env.production` (copy from `.env.production.example`) for cloud deploys with Upstash `rediss://` URL and hosted DB.
- Keep secrets out of git; inject them via your host (Cloud Run, Azure, Actions secrets).

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `IS_LOCAL` | `1` | `1` to prefer local Redis; `0` to prefer cloud Redis |
| `REDIS_URL_LOCAL` | `redis://localhost:6379` | Local Redis URL (used when `IS_LOCAL=1`) |
| `REDIS_URL_CLOUD` | — | Cloud Redis URL (e.g., Upstash `rediss://...`, used when `IS_LOCAL=0`) |
| `REDIS_URL` | — | Redis connection string |
| `CLASSIFY_QUEUE_NAME` | `schoollens-classify` | Classification queue |
| `CRAWLER_QUEUE_NAME` | `schoollens-crawl` | Crawl queue |
| `SCORING_QUEUE_NAME` | `schoollens-score` | Scoring queue |
| `EDUCATION_CONFIDENCE_THRESHOLD` | `60` | Min % to pass classification |
| `OPENAI_API_KEY` | — | OpenAI key (optional, enables AI scoring) |
| `OPENAI_MODEL_CHAT` | `gpt-4o` | Model for Q&A |
| `OPENAI_MODEL_SCORING` | `gpt-4o-mini` | Model for score extraction |
| `INTERNAL_API_KEY` | `change-me` | Shared secret for worker callbacks |
| `CRAWLER_API_BASE_URL` | `http://localhost:3000` | API base for workers |
| `B2B_CTA_URL` | `https://edpicker.com/verify` | B2B verification landing page |
| `STORAGE_PROVIDER` | `s3` | `s3` or `azure` |
| `S3_ENDPOINT` | `http://localhost:9000` | MinIO/S3 endpoint |
| `AZURE_STORAGE_CONNECTION_STRING` | — | Azure Blob (when provider=azure) |

## OpenAI (Optional)

Without an API key, the scoring worker uses keyword/regex fallback — scores are still produced but less accurate. Set the key when ready:
```env
OPENAI_API_KEY=sk-...
```

## Database Migrations

Migrations live in `sql/migrations/` and are numbered sequentially:
- `001_scoring_v2.sql` — Adds classification, safety scores, clarity scores, B2B leads tables, and crawl stat columns

Apply with: `psql $DATABASE_URL -f sql/migrations/001_scoring_v2.sql`
