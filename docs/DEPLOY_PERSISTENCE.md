# Data persistence on deploy (Render.com)

Production: **leads.adhello.ai** on [Render](https://render.com).

## Why data disappears

Leads OS stores **everything** in one SQLite file:

| Data | Storage |
|------|---------|
| Saved leads, pipeline, folders | `app.db` → `kv` table |
| Search / scrape history | `app.db` |
| Workspace settings & encrypted API keys | `app.db` |
| CEO chat history | `app.db` → `chat_messages` |

Default path: **`/app/data/app.db`** (Docker) or `data/app.db` locally.

On Render, the container filesystem is **ephemeral** unless you attach a **Persistent Disk**. Each deploy without a disk starts with an empty `data/` folder — integrations and scraped leads vanish even though **Test & save** succeeded.

The `data/` directory is **gitignored** and never ships with git.

---

## Fix on Render (recommended)

### Option A — Dashboard (existing service)

1. Open [Render Dashboard](https://dashboard.render.com) → your **Web Service** (e.g. adhelloleadsos).
2. Go to **Disks** → **Add disk**.
3. Settings:
   - **Mount path:** `/app/data`  
     (matches the app default — no code change needed)
   - **Size:** 1 GB minimum (increase later if needed)
4. Click **Save**. Render redeploys once.

5. Under **Environment**, confirm these are set (add if missing):

   | Key | Value |
   |-----|--------|
   | `BASE_URL` | `https://leads.adhello.ai` |
   | `WORKSPACE_INTEGRATIONS_SECRET` | Long random string, **16+ chars** — keep the same forever |
   | `SESSION_SECRET` | Long random string |

   Optional override (only if you mount the disk somewhere else):

   | Key | Value |
   |-----|--------|
   | `APP_DATA_DIR` | Absolute mount path (e.g. `/var/data`) |

   Optional after disk is attached (clears the in-app persistence warning):

   | Key | Value |
   |-----|--------|
   | `RENDER_DISK_MOUNTED` | `1` |

6. After deploy finishes:
   - Re-enter API keys → **Test & save** on each integration card
   - Run a lead search to confirm data sticks
   - Deploy again — leads and keys should remain

**Note:** Persistent disks require a **paid** Render plan (Starter or higher). Free web services cannot attach disks.

---

### Option B — `render.yaml` in repo

This repo includes a [`render.yaml`](../render.yaml) blueprint. If you manage the service via Blueprint:

1. Sync the blueprint in Render (or create service from repo).
2. The disk mounts at `/app/data` automatically.
3. Set secret env vars in the dashboard when prompted (`sync: false` keys).

---

## Encryption secret (API keys)

Keys saved from **Workspace → Integrations** are encrypted with **`WORKSPACE_INTEGRATIONS_SECRET`**.

- Must be **at least 16 characters**
- Must stay **identical across every deploy**
- If it changes, saved keys cannot be decrypted — re-enter keys and **Test & save**

Render: **Environment** → add `WORKSPACE_INTEGRATIONS_SECRET` → **Save Changes** (triggers redeploy).

---

## Verify it worked

1. **Logs** (Render → service → Logs) on startup:
   ```
   [persist] SQLite /app/data/app.db — N keys, …
   ```
   You should **not** see:
   ```
   WARNING: Running on a serverless host without APP_DATA_DIR
   ```

2. **Integrations page** — amber “Data persistence” banner should disappear after disk + secret are configured.

3. **Redeploy test** — save a lead, push to `main`, confirm it still exists after deploy.

---

## Backups

Each **Test & save** / **Save integrations** writes a timestamped copy on the same disk:

```
/app/data/app.db.backup-2026-06-01T…
```

Download periodically from a one-off shell (Render → Shell) or automate off-site backup later.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Everything empty after deploy | No persistent disk, or disk not mounted at `/app/data` |
| Keys show as saved but don’t work | `WORKSPACE_INTEGRATIONS_SECRET` missing or changed |
| “Saved API keys unavailable” banner | Secret changed since keys were saved — restore old secret or re-save keys |
| Disk added but still empty | Wrong mount path; set `APP_DATA_DIR` to match mount path |

---

## Other hosts

The repo also has a Cloud Run GitHub Action (`.github/workflows/deploy.yml`). For GCP, use a GCS bucket volume and `APP_DATA_DIR=/data` — not used if production is Render-only.

Long term: migrate from SQLite to **Render Postgres** or external DB for multi-instance scaling.
