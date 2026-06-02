# Data persistence on deploy (Render.com)

Production: **[adhelloleadsos.onrender.com](https://adhelloleadsos.onrender.com)** on [Render](https://render.com).

## Why data disappears

Leads OS stores **everything** in one SQLite file:

| Data | Storage |
|------|---------|
| Saved leads, pipeline, folders | `app.db` → `kv` table |
| Search / scrape history | `app.db` |
| Workspace settings & encrypted API keys | `app.db` |
| CEO chat history | `app.db` → `chat_messages` |

Default path: **`/opt/render/project/src/data/app.db`** on Render Node, **`/app/data/app.db`** on Docker, or `data/app.db` locally.

On Render, the container filesystem is **ephemeral** unless you attach a **Persistent Disk**. Each deploy without a disk starts with an empty `data/` folder — integrations and scraped leads vanish even though **Test & save** succeeded.

The `data/` directory is **gitignored** and never ships with git.

---

## Fix on Render (recommended)

### Option A — Dashboard (existing service)

1. Open [Render Dashboard](https://dashboard.render.com) → your **Web Service** (e.g. adhelloleadsos).
2. Go to **Disks** → **Add disk** (or confirm existing disk).
3. **Mount path** depends on runtime:

   | Runtime | Mount path |
   |---------|------------|
   | **Node** (Build: `npm install`, Start: `node server.js`) | `/opt/render/project/src/data` |
   | **Docker** (uses `Dockerfile`) | `/app/data` |

   Your screenshot (`/opt/render/project/src/data`) is **correct for Node.js**.

4. **Size:** 1 GB minimum.

5. Under **Environment**, confirm these are set (add if missing):

   | Key | Value |
   |-----|--------|
   | `BASE_URL` | `https://adhelloleadsos.onrender.com` (no trailing slash) |
   | `WORKSPACE_INTEGRATIONS_SECRET` | Long random string, **16+ chars** — keep the same forever |
   | `SESSION_SECRET` | Long random string |
   | `RENDER_DISK_MOUNTED` | `1` (after disk is attached — clears in-app warning) |

   Only if your disk mount path is custom:

   | Key | Value |
   |-----|--------|
   | `APP_DATA_DIR` | Exact disk mount path (e.g. `/opt/render/project/src/data`) |

6. Click **Save**. Render redeploys once.

7. After deploy finishes:
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

1. **Logs** (Render → service → Logs) on startup — confirm paths align:
   ```
   [persist] SQLite /opt/render/project/src/data/app.db — N keys, …
   ```
   If you see `/app/data/app.db` but disk is at `/opt/render/project/src/data`, paths **do not match** — set `APP_DATA_DIR=/opt/render/project/src/data` or remount the disk.

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
