# Data persistence on deploy (Cloud Run / Render)

## Why data disappears

Leads OS stores **everything** in a single SQLite file:

| Data | Storage |
|------|---------|
| Saved leads, pipeline, folders | `app.db` → `kv` table |
| Search / scrape history | `app.db` |
| Workspace settings & encrypted API keys | `app.db` |
| CEO chat history | `app.db` → `chat_messages` |

Default path: **`data/app.db`** inside the container (`/app/data/app.db` in Docker).

On **Google Cloud Run** (and most PaaS hosts), the container filesystem is **ephemeral**. Each deploy builds a new container with an **empty** `data/` folder. That is why integrations and scraped leads vanish after every push — not because Test & save failed.

The `data/` directory is also **gitignored**, so it is never shipped with the code.

---

## Fix: mount persistent storage

### 1. Create a GCS bucket (one time)

```bash
export PROJECT_ID=your-gcp-project
export BUCKET=adhello-leadsos-data-${PROJECT_ID}

gcloud storage buckets create gs://${BUCKET} \
  --project=${PROJECT_ID} \
  --location=us-west1 \
  --uniform-bucket-level-access
```

### 2. Mount the bucket on Cloud Run

After the first deploy, update the service (or add to your deploy pipeline):

```bash
gcloud run services update adhello-leadsos \
  --region=us-west1 \
  --add-volume=name=leads-data,type=cloud-storage,bucket=${BUCKET} \
  --add-volume-mount=volume=leads-data,mount-path=/data \
  --update-env-vars=APP_DATA_DIR=/data
```

SQLite will then read/write **`/data/app.db`**, which survives redeploys.

### 3. Set a stable encryption secret (required for UI API keys)

Workspace integration keys are encrypted with **`WORKSPACE_INTEGRATIONS_SECRET`** (min 16 characters).

```bash
gcloud run services update adhello-leadsos \
  --region=us-west1 \
  --update-env-vars=WORKSPACE_INTEGRATIONS_SECRET='your-long-stable-secret-here'
```

**Important:** If this secret changes, previously saved keys cannot be decrypted. You must either restore the old secret or re-enter keys and use **Test & save**.

Add the same value in Cloud Run → Environment variables (never commit it to git).

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `APP_DATA_DIR` | Directory for `app.db` (e.g. `/data` on a mounted volume) |
| `WORKSPACE_INTEGRATIONS_SECRET` | Encrypts API keys saved from Workspace → Integrations |

See `.env.example` for local development.

---

## Verify after setup

1. Deploy with volume + env vars.
2. Check Cloud Run logs on startup:
   - `[persist] SQLite /data/app.db — N keys, …`
   - No `WARNING: Running on a serverless host without APP_DATA_DIR`.
3. Save integrations, run a lead search, redeploy — data should remain.
4. Workspace → Integrations should **not** show the amber “Data persistence” banner.

---

## Backups

Each integration **Test & save** (and **Save integrations**) creates a timestamped copy on the same volume:

`app.db.backup-2026-06-01T…`

Copy these to cold storage periodically:

```bash
gcloud storage cp /data/app.db.backup-* gs://${BUCKET}/backups/
```

---

## Render (alternative host)

1. Add a **Persistent Disk** (1 GB+) in Render dashboard.
2. Mount it at `/data`.
3. Set `APP_DATA_DIR=/data` and `WORKSPACE_INTEGRATIONS_SECRET` in environment.

---

## Long term

For multi-instance scaling, consider **Cloud SQL (PostgreSQL)** instead of SQLite. That is a larger migration; the volume mount above is the minimal fix for a single Cloud Run instance.
