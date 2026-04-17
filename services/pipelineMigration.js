const db = require('./database');
const {
  PIPELINE_SCHEMA_VERSION,
  LEGACY_EIGHT_STAGE_TO_NEW,
  clampPipelineStage,
} = require('./pipelineConstants');

/**
 * One-time remap: legacy 8 stages → 10-stage model. Idempotent via pipelineSchemaVersion.
 */
async function migrateLegacyPipelineStages() {
  const leads = await db.getAllLeads();
  let updated = 0;

  for (const lead of leads) {
    if (lead.pipelineSchemaVersion === PIPELINE_SCHEMA_VERSION) continue;

    const ps = parseInt(lead.pipelineStage, 10);
    let newStage;
    if (!Number.isFinite(ps)) {
      newStage = 1;
    } else if (ps >= 1 && ps <= 8) {
      newStage = LEGACY_EIGHT_STAGE_TO_NEW[ps] ?? ps;
    } else if (ps > 10) {
      newStage = 10;
    } else {
      newStage = clampPipelineStage(ps);
    }

    await db.updateLead(lead.key, {
      pipelineStage: newStage,
      pipelineSchemaVersion: PIPELINE_SCHEMA_VERSION,
      logs: [
        {
          type: 'migration',
          message: `Pipeline schema v${PIPELINE_SCHEMA_VERSION}: stage ${ps} → ${newStage} (expanded methodology).`,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    updated += 1;
  }

  if (updated > 0) {
    console.log(`[PIPELINE] Migrated ${updated} lead(s) to schema v${PIPELINE_SCHEMA_VERSION}.`);
  }
}

module.exports = {
  migrateLegacyPipelineStages,
};
