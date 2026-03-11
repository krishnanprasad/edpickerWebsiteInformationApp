# SchoolLens

School website transparency scanner — crawl, classify, and score educational institution websites for safety & decision clarity.

## Features

### B2C Features (v2)
1. **Pre-scan Classification** — Detects if a URL is an educational institution before crawling (15 keyword check, ≥60 % confidence threshold).
2. **Safety & Transparency Score** — 0-100 score across 5 checklist items: Fire Safety Certificate, Sanitary Certificate, CCTV/Security, Transport Safety, Anti-Bullying Policy. Color-coded badges (🟢 ≥80, 🟡 ≥50, 🔴 <50).
3. **Parent Clarity Index** — 0-100 "Decision Clarity Level" measuring 5 factors: Admission Dates, Fee Structure, Academic Calendar, Contact & Map, Results/Outcomes.
4. **Crawl Transparency** — Shows pages/PDFs/images scanned, crawl depth, scan time, and confidence level.
5. **B2B CTA Hook** — "School can verify & improve this score" call-to-action tracking.
6. **Mandatory Document Audit (CBSE)** — Detects mandatory disclosure PDFs, marks missing documents, extracts expiry dates, and flags `needs_review` when data is unclear/conflicting.

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

### 2.1 Bulk crawl all schools from DB
This runs a one-off Docker job named `crawl-all-website` and enqueues scans for all rows in `schools.website_url`.

```bash
docker compose --profile tools run --rm crawl-all-website
```

Useful overrides:
```bash
# Process only first N schools
CRAWL_ALL_LIMIT=2000 docker compose --profile tools run --rm crawl-all-website

# Increase parallel enqueue speed
CRAWL_ALL_CONCURRENCY=10 docker compose --profile tools run --rm crawl-all-website

# Include already analysed schools too
CRAWL_ALL_INCLUDE_ANALYSED=1 docker compose --profile tools run --rm crawl-all-website

# Dry run (no API calls)
CRAWL_ALL_DRY_RUN=1 docker compose --profile tools run --rm crawl-all-website
```

### 3. Run migration (existing databases)
If the database already has the base schema, apply the migrations manually:
```bash
psql $DATABASE_URL -f sql/migrations/001_scoring_v2.sql
psql $DATABASE_URL -f sql/migrations/002_early_identity.sql
psql $DATABASE_URL -f sql/migrations/003_crawler_v2.sql
psql $DATABASE_URL -f sql/migrations/004_compare_lists.sql
psql $DATABASE_URL -f sql/migrations/005_schools_registry.sql
psql $DATABASE_URL -f sql/migrations/006_mandatory_documents.sql
psql $DATABASE_URL -f sql/migrations/008_ai_audit.sql
psql $DATABASE_URL -f sql/migrations/009_paid_reports_v1.sql
```
New databases auto-apply schema + migrations via Docker init scripts.

### 4. Open
- **Angular app**: `http://localhost:4200` (via `nx run web:dev`)
- **API + static UI**: `http://localhost:3000`
- **MinIO console**: `http://localhost:9001`
- **Analytics dashboard**: `http://localhost:4200/analytics` (or `http://localhost:3000/analytics`)
  - Default password: `123456`
  - Override with env: `ANALYTICS_PASSWORD=your-password`

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
| GET | `/api/scan/:id/school-info-core` | 10-category School Information Core score (0-3 each; OpenAI with Gemini fallback) |
| GET | `/api/schools/search?q=...` | Public autocomplete for already crawled schools (`crawl_status` in `analysed`,`partial`) |

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
| `PAID_REPORT_QUEUE_NAME` | `schoollens-paid-report` | Paid report orchestration queue |
| `PAID_REPORT_QUEUE_CONCURRENCY` | `2` | Max parallel paid reports |
| `PAID_REPORT_TIMEOUT_MS` | `1800000` | Whole paid report timeout (30 min) |
| `EDUCATION_CONFIDENCE_THRESHOLD` | `60` | Min % to pass classification |
| `OPENAI_API_KEY` | — | OpenAI key (optional, enables AI scoring) |
| `OPENAI_MODEL_CHAT` | `gpt-4o` | Model for Q&A |
| `OPENAI_MODEL_SCORING` | `gpt-4o-mini` | Model for score extraction |
| `OPENAI_MODEL_PAID_REPORT` | `gpt-4o` | Paid report layer-1 model |
| `GEMINI_API_KEY` | — | Gemini API key |
| `GEMINI_MODEL_PAID_REPORT` | `gemini-1.5-pro` | Paid report layer-2 model |
| `CLAUDE_API_KEY` | — | Claude API key (paid report synthesis) |
| `CLAUDE_MODEL_PAID_REPORT` | `claude-sonnet-4-20250514` | Paid report layer-3 model |
| `GROK_API_KEY` | — | Grok API key (fallback model). `X_API_KEY` is also accepted as alias. |
| `GROK_BASE_URL` | `https://api.x.ai/v1` | Grok API base URL |
| `GROK_MODEL_PAID_REPORT` | `grok-3-mini` | Paid report fallback model |
| `GOOGLE_PLACES_API_KEY` | — | Places API key for fresh rating/reviews |
| `YOUTUBE_API_KEY` | — | YouTube data API key for social snapshot |
| `INTERNAL_API_KEY` | `change-me` | Shared secret for worker callbacks |
| `ADMIN_GLOBAL_PIN_ROTATE_MINUTES` | `60` | Rotation window for global 6-digit admin PIN |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` | — | Ops alert email transport |
| `OPS_ALERT_EMAIL_TO` | `edpickerteam@gmail.com` | Failure/limited-evidence alert inbox |
| `CRAWLER_API_BASE_URL` | `http://localhost:3000` | API base for workers |
| `CRAWL_ALL_API_BASE_URL` | `http://localhost:3000` | API base used by `crawl-all-website` job |
| `CRAWL_ALL_CONCURRENCY` | `5` | Parallel API enqueue workers for bulk crawl |
| `CRAWL_ALL_LIMIT` | `0` | Max schools to enqueue (`0` = all) |
| `CRAWL_ALL_INCLUDE_ANALYSED` | `0` | `1` to include schools already marked `analysed` |
| `CRAWL_ALL_DRY_RUN` | `0` | `1` to list/process selection without enqueueing scans |
| `B2B_CTA_URL` | `https://edpicker.com/verify` | B2B verification landing page |
| `ANALYTICS_PASSWORD` | `123456` | Password required by `/analytics` page and `/api/analytics/overview` |
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
- `002_early_identity.sql` - Adds homepage identity extraction fields
- `003_crawler_v2.sql` - Adds crawler queue/facts/stat tracking tables
- `004_compare_lists.sql` - Adds compare list tables
- `005_schools_registry.sql` - Adds permanent schools table and per-field merge metadata
- `006_mandatory_documents.sql` - Adds mandatory document audit table with expiry/details/review status per school
- `008_ai_audit.sql` - Adds async AI audit status/log tables
- `009_paid_reports_v1.sql` - Adds paid report sessions, model token metrics, step telemetry, admin PIN/access code

Apply with: `psql $DATABASE_URL -f sql/migrations/001_scoring_v2.sql`
