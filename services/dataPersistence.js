/**
 * Startup checks for SQLite persistence (Render / Cloud Run use ephemeral disks without a mount).
 */

const fs = require('fs');
const path = require('path');
const dbService = require('./database');
const workspaceIntegrations = require('./workspaceIntegrations');

/** Render persistent disk mount paths by runtime (see Render docs). */
const RENDER_DISK_PATHS = {
  node: '/opt/render/project/src/data',
  docker: '/app/data',
};

function getDbDir() {
  return path.dirname(dbService.getDbPath());
}

function renderDiskPathHint() {
  if (process.env.RENDER_SERVICE_TYPE === 'web' && process.env.RENDER_RUNTIME === 'docker') {
    return RENDER_DISK_PATHS.docker;
  }
  return RENDER_DISK_PATHS.node;
}

function dbDirMatchesRenderDiskMount() {
  if (!process.env.RENDER) return false;
  const dbDir = getDbDir();
  return dbDir === RENDER_DISK_PATHS.node || dbDir === RENDER_DISK_PATHS.docker;
}

function renderDiskPathMismatch() {
  if (!process.env.RENDER || process.env.RENDER_DISK_MOUNTED === '1') return null;
  if (isCustomDataDir()) {
    const custom = path.resolve(String(process.env.APP_DATA_DIR).trim());
    return { dbDir: custom, expected: custom, ok: true };
  }
  const dbDir = getDbDir();
  const expected = renderDiskPathHint();
  if (dbDir === expected) return null;
  return { dbDir, expected, ok: false };
}

function isLikelyEphemeralHost() {
  return Boolean(
    process.env.K_SERVICE ||
      process.env.CLOUD_RUN_JOB ||
      process.env.RENDER ||
      process.env.RENDER_SERVICE_ID,
  );
}

function isCustomDataDir() {
  return Boolean(process.env.APP_DATA_DIR && String(process.env.APP_DATA_DIR).trim());
}

/**
 * Log DB location and warn when production looks like a fresh ephemeral instance.
 */
function logStartupPersistenceStatus() {
  const stats = dbService.getPersistenceStats();
  const sizeKb = Math.round((stats.dbSizeBytes || 0) / 1024);
  console.log(
    `[persist] SQLite ${stats.dbPath} — ${stats.kvCount} keys, ~${sizeKb} KB` +
      (stats.leadKeyCount != null ? `, ${stats.leadKeyCount} lead keys` : ''),
  );

  if (isLikelyEphemeralHost() && !process.env.RENDER && !isCustomDataDir()) {
    console.warn(
      '[persist] WARNING: Running without persistent storage. ' +
        'SQLite is wiped on every deploy. See docs/DEPLOY_PERSISTENCE.md',
    );
  } else if (process.env.RENDER) {
    const mismatch = renderDiskPathMismatch();
    if (mismatch && !mismatch.ok) {
      console.warn(
        `[persist] WARNING: SQLite writes to ${mismatch.dbDir} but Render disk is usually mounted at ${mismatch.expected}. ` +
          'Set APP_DATA_DIR to your disk mount path, or remount the disk to match. See docs/DEPLOY_PERSISTENCE.md',
      );
    } else if (!renderPersistenceConfigured()) {
      console.warn(
        '[persist] WARNING: Render disk may not be wired yet — confirm mount path matches SQLite dir in log above. ' +
          'Set RENDER_DISK_MOUNTED=1 after disk is attached. See docs/DEPLOY_PERSISTENCE.md',
      );
    }
  }

  if (process.env.NODE_ENV === 'production' && stats.kvCount === 0 && stats.dbSizeBytes < 8192) {
    console.warn(
      '[persist] WARNING: Database looks empty. Leads, searches, and saved integrations will not survive ' +
        'unless APP_DATA_DIR points to a persistent volume.',
    );
  }

  if (
    process.env.WORKSPACE_INTEGRATIONS_SECRET &&
    String(process.env.WORKSPACE_INTEGRATIONS_SECRET).length < 16
  ) {
    console.warn(
      '[persist] WARNING: WORKSPACE_INTEGRATIONS_SECRET is set but shorter than 16 characters — UI integration saves are disabled.',
    );
  }
}

/**
 * @param {object|null} workspace
 * @returns {{ level: 'ok'|'warn'|'err', message: string }|null}
 */
function workspaceIntegrationsPersistenceHint(workspace) {
  const state = workspaceIntegrations.integrationsStorageState(workspace);
  if (state === 'locked') {
    return {
      level: 'err',
      message:
        'Saved API keys exist but WORKSPACE_INTEGRATIONS_SECRET is missing on the server. Set the same secret used when keys were saved, or re-enter keys after configuring it.',
    };
  }
  if (state === 'decrypt_failed') {
    return {
      level: 'err',
      message:
        'Saved API keys cannot be decrypted — WORKSPACE_INTEGRATIONS_SECRET likely changed since they were saved. Restore the original secret or re-enter keys and use Test & save.',
    };
  }
  return null;
}

function renderPersistenceConfigured() {
  if (!process.env.RENDER) return false;
  if (process.env.RENDER_DISK_MOUNTED === '1') return true;
  if (dbDirMatchesRenderDiskMount()) {
    const stats = dbService.getPersistenceStats();
    if (stats.dbExists && stats.dbSizeBytes > 4096) return true;
  }
  const stats = dbService.getPersistenceStats();
  return stats.kvCount > 0 && stats.dbSizeBytes > 16384;
}

/**
 * @returns {{ level: 'ok'|'warn', message: string }|null}
 */
function deploymentPersistenceHint() {
  if (process.env.RENDER) {
    const mismatch = renderDiskPathMismatch();
    if (mismatch && !mismatch.ok) {
      return {
        level: 'err',
        message:
          `SQLite is writing to ${mismatch.dbDir}, but your Render disk is probably mounted elsewhere. ` +
          `For Node.js use mount path ${RENDER_DISK_PATHS.node}; for Docker use ${RENDER_DISK_PATHS.docker}. ` +
          'Set APP_DATA_DIR to match your disk mount path, then redeploy.',
      };
    }
    if (!renderPersistenceConfigured()) {
      return {
        level: 'warn',
        message:
          'Add or confirm a Render Persistent Disk whose mount path matches where SQLite stores data ' +
          `(Node.js: ${RENDER_DISK_PATHS.node}, Docker: ${RENDER_DISK_PATHS.docker}). ` +
          'Then set WORKSPACE_INTEGRATIONS_SECRET, RENDER_DISK_MOUNTED=1, re-save API keys, and redeploy once.',
      };
    }
  }
  if (isLikelyEphemeralHost() && !process.env.RENDER && !isCustomDataDir()) {
    return {
      level: 'warn',
      message:
        'This server uses a temporary disk — leads, search history, and workspace API keys are lost on every deploy until persistent storage is configured (docs/DEPLOY_PERSISTENCE.md).',
    };
  }
  const stats = dbService.getPersistenceStats();
  if (process.env.NODE_ENV === 'production' && stats.kvCount === 0 && isCustomDataDir()) {
    return {
      level: 'warn',
      message:
        'Persistent volume is mounted but the database is empty. If you expected existing data, check that APP_DATA_DIR matches the volume mount path.',
    };
  }
  return null;
}

/**
 * Copy app.db (+ WAL) to a timestamped backup alongside the DB (same volume).
 * @returns {string|null} backup path
 */
function backupSqliteSnapshot() {
  const stats = dbService.getPersistenceStats();
  if (!stats.dbExists) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${stats.dbPath}.backup-${stamp}`;
  fs.copyFileSync(stats.dbPath, dest);
  for (const suffix of ['-wal', '-shm']) {
    const side = stats.dbPath + suffix;
    if (fs.existsSync(side)) fs.copyFileSync(side, dest + suffix);
  }
  return dest;
}

module.exports = {
  logStartupPersistenceStatus,
  workspaceIntegrationsPersistenceHint,
  deploymentPersistenceHint,
  backupSqliteSnapshot,
  isLikelyEphemeralHost,
  isCustomDataDir,
};
