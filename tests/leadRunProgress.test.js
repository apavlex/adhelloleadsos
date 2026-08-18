const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  EST_MS,
  STALE_MS,
  computeLeadRunTargetPct,
  isLeadRunJobStale,
  shouldFinishLeadRunBanner,
  resolveLeadRunDisplayPct,
  withTimeout,
  runBestEffort,
} = require('../services/leadRunProgress');

describe('leadRunProgress', () => {
  const startedAt = '2026-08-18T20:00:00.000Z';
  const t0 = Date.parse(startedAt);

  it('caps in-progress percent at 99 even after the estimate elapses', () => {
    assert.equal(computeLeadRunTargetPct(startedAt, t0), 1);
    assert.equal(computeLeadRunTargetPct(startedAt, t0 + EST_MS), 99);
    assert.equal(computeLeadRunTargetPct(startedAt, t0 + EST_MS * 4), 99);
    assert.ok(computeLeadRunTargetPct(startedAt, t0 + 30 * 1000) < 99);
    assert.ok(computeLeadRunTargetPct(startedAt, t0 + 30 * 1000) >= 1);
  });

  it('never reports 100% while the job is still processing and not stale', () => {
    const pct = resolveLeadRunDisplayPct({
      isProcessing: true,
      startedAt,
      now: t0 + EST_MS,
    });
    assert.equal(pct, 99);
  });

  it('reports 100% when processing ends, even if elapsed time is short', () => {
    assert.equal(
      resolveLeadRunDisplayPct({
        isProcessing: false,
        startedAt,
        now: t0 + 5000,
      }),
      100
    );
    assert.equal(shouldFinishLeadRunBanner({ isProcessing: false, startedAt, now: t0 + 5000 }), true);
  });

  it('treats a stale running job as complete so the banner can leave 99%', () => {
    const now = t0 + STALE_MS;
    assert.equal(isLeadRunJobStale(startedAt, now), true);
    assert.equal(isLeadRunJobStale(startedAt, t0 + STALE_MS - 1), false);
    assert.equal(shouldFinishLeadRunBanner({ isProcessing: true, startedAt, now }), true);
    assert.equal(resolveLeadRunDisplayPct({ isProcessing: true, startedAt, now }), 100);
  });

  it('withTimeout rejects hung work and runBestEffort keeps the fallback', async () => {
    await assert.rejects(
      () => withTimeout(new Promise(() => {}), 30, 'hung_enrich'),
      /hung_enrich timed out/
    );

    const kept = await runBestEffort(
      () => new Promise(() => {}),
      [{ title: 'Kent Flooring' }],
      30,
      'search_enrich'
    );
    assert.equal(kept.timedOut, true);
    assert.equal(kept.value[0].title, 'Kent Flooring');
    assert.match(kept.error, /timed out/);

    const ok = await runBestEffort(() => Promise.resolve(['enriched']), ['raw'], 200, 'fast');
    assert.equal(ok.timedOut, false);
    assert.deepEqual(ok.value, ['enriched']);
  });
});
