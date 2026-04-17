/**
 * Unified pipeline versioning + legacy 8-stage → 10-stage map.
 */

const PIPELINE_SCHEMA_VERSION = 2;
const PIPELINE_STAGE_MAX = 10;

/** Old 8-step methodology id → new id (same Niche=1; CQI was 2 → now 4, etc.) */
const LEGACY_EIGHT_STAGE_TO_NEW = {
  1: 1,
  2: 4,
  3: 5,
  4: 6,
  5: 7,
  6: 8,
  7: 9,
  8: 10,
};

function clampPipelineStage(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(PIPELINE_STAGE_MAX, Math.max(1, n));
}

/** Default stage for warm AdHello inbound (skip cold sub-stages → CQI). */
function defaultPipelineStageForSource(source) {
  if (!source || typeof source !== 'string') return 1;
  if (!source.startsWith('adhello_')) return 1;
  if (source === 'adhello_audit' || source === 'adhello_chatbot') return 4;
  if (source === 'adhello_strategy') return 5;
  if (source === 'adhello_brief') return 6;
  return 4;
}

module.exports = {
  PIPELINE_SCHEMA_VERSION,
  PIPELINE_STAGE_MAX,
  LEGACY_EIGHT_STAGE_TO_NEW,
  clampPipelineStage,
  defaultPipelineStageForSource,
};
