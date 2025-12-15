# CMQUO Ledger Deployment Cheat Sheet

This repo now publishes the CMQUO invoice API to Google Cloud Run and stores ledger data in Cloud SQL. Use this doc as the runbook for rebuilding the setup or onboarding a new teammate.

## 1. Local Preconditions

- Node 20.x and npm installed
- Python 3.11 (for the `accounts` utilities) – handy for local scripts, not required in the container
- Google Cloud SDK (`gcloud`) installed and authenticated against the `fearless-leader` project
  - `gcloud init --console-only --project fearless-leader`
  - Default region/zone used so far: `europe-west2` / `europe-west2-b`
- Firebase CLI authenticated to the same project

## 2. Code Layout Recap

- `services/api` – Express app that receives invoice payloads and posts them into the ledger database
  - `Dockerfile` performs a multi-stage TypeScript build and copies `templates/invoice.hbs.html`
  - Runtime dependencies include `express`, `pg`, `handlebars`, `dotenv`, `zod`
- `services/api/templates/invoice.hbs.html` – HTML template bundled with the container
- Cloud Function (in the command console repo) calls `POST /invoices`
- Cloud SQL instance: `cmquo-ledger-dev` (PostgreSQL 17) in region `europe-west2`

## 3. Build & Test Locally

```powershell
cd services/api
npm install
npm run build           # compile TypeScript -> dist
npm run dev             # optional: run locally (needs Postgres env vars)
```

If you point the API at Cloud SQL locally, you will need:

```
PGHOST=/cloudsql/fearless-leader:europe-west2:cmquo-ledger-dev   # or use the Cloud SQL Auth Proxy locally
PGPORT=5432
PGDATABASE=postgres
PGUSER=cmquo_app
PGPASSWORD=<app-user-password>
PGSSLMODE=disable
```

## 4. Google Cloud Prerequisites

1. Enable required services (one-time):
   ```powershell
   gcloud services enable run.googleapis.com sqladmin.googleapis.com
   ```

2. Permit the Cloud Run service account to reach Cloud SQL:
   ```powershell
   gcloud projects add-iam-policy-binding fearless-leader `
     --member=serviceAccount:fearless-leader@appspot.gserviceaccount.com `
     --role=roles/cloudsql.client
   ```

## 5. Build Container & Push with Cloud Build

From `services/api`:

```powershell
# set once per session so the deploy command can read it
$env:PGPASSWORD = '<postgres-app-password>'

# build and push image to gcr.io
gcloud builds submit --tag gcr.io/fearless-leader/cmquo-api
```

Multi-stage Dockerfile steps:
- `npm ci` installs dependencies (dev + prod) in the build stage
- `npm run build` compiles TypeScript into `dist`
- Runtime stage copies `dist/` and `templates/` and installs production deps only

## 6. Deploy to Cloud Run

```powershell
gcloud run deploy cmquo-api `
  --image gcr.io/fearless-leader/cmquo-api `
  --region europe-west2 `
  --allow-unauthenticated `
  --add-cloudsql-instances fearless-leader:europe-west2:cmquo-ledger-dev `
  --set-env-vars "PGHOST=/cloudsql/fearless-leader:europe-west2:cmquo-ledger-dev,PGPORT=5432,PGDATABASE=postgres,PGUSER=cmquo_app,PGPASSWORD=$env:PGPASSWORD,PGSSLMODE=disable"
```

Cloud Run injects `PORT` automatically (8080). If the service fails to start, inspect logs:

```powershell
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="cmquo-api"' `
  --limit 20 `
  --format "value(textPayload)"
```

## 7. Update Firebase Functions Config

```powershell
firebase functions:config:set LEDGER_API_BASE="https://cmquo-api-891476346781.europe-west2.run.app"
firebase deploy --only functions
```

Keep existing `LEDGER_SELLER_*` values aligned; consider migrating to Firestore config later.

## 8. Verification Checklist

1. Health endpoint:
   ```powershell
   curl https://cmquo-api-891476346781.europe-west2.run.app/health
   ```
2. Create an invoice in the Command Console -> Firestore stores it -> Cloud Function posts to `/invoices`
3. Confirm ledger entries in Cloud SQL (Cloud Shell):
   ```sql
   SELECT * FROM invoices ORDER BY id DESC LIMIT 5;
   SELECT * FROM postings WHERE invoice_id = '...';
   ```

## 9. Common Failure Modes

| Symptom | Fix |
| --- | --- |
| `ERR_MODULE_NOT_FOUND dotenv` | Ensure `dotenv` is a production dependency, rebuild container |
| `ENOENT /app/templates/invoice.hbs.html` | Confirm template lives in `services/api/templates` and Dockerfile copies it |
| Cloud Run timeout listening on port 8080 | App crashed on startup – check logs for stack trace (DB creds, schema, etc.) |
| Postgres connection refused | Verify `roles/cloudsql.client` and env vars (especially socket path) |
| Schema errors | `\i db/postgres/init_ledger.sql` against the Cloud SQL instance |

## 10. Next Steps / Ideas

- Move database password into Secret Manager and deploy with `--set-secrets`
- Use the Cloud SQL Auth Proxy for local dev instead of SQLite
- Automate Cloud Build + Cloud Run deploys via CI (e.g., GitHub Actions)
- Keep Firebase security rules aligned with any new billing collections

Keep this document updated whenever the deployment process changes so future you (or a future Codex instance) can reproduce the setup without digging through logs.
