/**
 * Browser helpers for review freshness labels (mirrors services/reviewFreshness.js).
 * Load before app.js / lead-panel-paint.js.
 */
(function (global) {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function parseReviewDate(raw) {
    if (raw == null || raw === '') return null;
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      const ms = raw < 1e12 ? raw * 1000 : raw;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const s = String(raw).trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return parseReviewDate(Number(s));
    const mdy = s.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (mdy) {
      const d = new Date(
        Date.UTC(
          parseInt(mdy[3], 10),
          parseInt(mdy[1], 10) - 1,
          parseInt(mdy[2], 10),
          mdy[4] != null ? parseInt(mdy[4], 10) : 0,
          mdy[5] != null ? parseInt(mdy[5], 10) : 0,
          mdy[6] != null ? parseInt(mdy[6], 10) : 0
        )
      );
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDaysAgo(days) {
    if (!Number.isFinite(days) || days < 0) return '';
    if (days < 1) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 30) return days + ' days ago';
    if (days < 60) return 'about a month ago';
    const months = Math.floor(days / 30);
    if (months < 12) return months + ' month' + (months === 1 ? '' : 's') + ' ago';
    const years = Math.floor(days / 365);
    if (years === 1) return 'about a year ago';
    return years + '+ years ago';
  }

  function labelReviewFreshness(input) {
    const nowMs =
      input && input.now != null
        ? input.now instanceof Date
          ? input.now.getTime()
          : Number(input.now)
        : Date.now();
    const reviewsCount =
      parseInt(input && (input.reviewsCount != null ? input.reviewsCount : input.reviews), 10) || 0;
    const rating =
      Number(input && (input.totalScore != null ? input.totalScore : input.rating)) || 0;
    const lastDate = input && input.lastReviewAt ? parseReviewDate(input.lastReviewAt) : null;
    const last30 =
      input && input.reviewsLast30Days != null && Number.isFinite(Number(input.reviewsLast30Days))
        ? Math.max(0, parseInt(input.reviewsLast30Days, 10) || 0)
        : null;

    if (reviewsCount <= 0 && !lastDate) {
      return {
        status: 'none',
        label: 'No Google reviews on file',
        shortLabel: 'No reviews',
        pitch: 'No review presence — pitch reputation & review generation.',
        daysSinceLast: null,
        lastReviewAt: null,
        reviewsLast30Days: last30,
      };
    }

    if (!lastDate) {
      return {
        status: 'unknown',
        label: 'Review dates unknown — run Enhance',
        shortLabel: 'Dates unknown',
        pitch: null,
        daysSinceLast: null,
        lastReviewAt: null,
        reviewsLast30Days: last30,
      };
    }

    const lastIso = lastDate.toISOString();
    const daysSince = Math.max(0, Math.floor((nowMs - lastDate.getTime()) / DAY_MS));
    const ago = formatDaysAgo(daysSince);

    let status = 'recent';
    if (daysSince <= 30) status = 'active';
    else if (daysSince <= 90) status = 'recent';
    else if (daysSince <= 180) status = 'cooling';
    else if (daysSince <= 365) status = 'stale';
    else status = 'dormant';

    let label = 'Last review: ' + ago;
    let shortLabel = ago === 'today' ? 'Today' : ago;
    if (status === 'active' && last30 != null && last30 > 0) {
      label = 'Active — ' + last30 + ' in last 30 days';
      shortLabel = last30 + ' / 30d';
    } else if (status === 'stale' || status === 'dormant') {
      label =
        daysSince >= 180
          ? 'No reviews in ' + (daysSince >= 365 ? '12+' : '6+') + ' months'
          : 'Last review: ' + ago;
      shortLabel = daysSince >= 365 ? '12+ mo quiet' : daysSince >= 180 ? '6+ mo quiet' : ago;
    }

    let pitch = null;
    if (status === 'stale' || status === 'dormant' || status === 'cooling') {
      pitch = 'Quiet review stream — pitch reputation management to restart reviews.';
    } else if (status === 'active' && rating > 0 && rating < 4.0) {
      pitch = 'Reviews are coming in but stars are soft — pitch reputation repair.';
    } else if (status === 'active' && reviewsCount > 0 && reviewsCount < 30) {
      pitch = 'Active but thin review volume — pitch review generation.';
    }

    return {
      status: status,
      label: label,
      shortLabel: shortLabel,
      pitch: pitch,
      daysSinceLast: daysSince,
      lastReviewAt: lastIso,
      reviewsLast30Days: last30,
    };
  }

  function freshnessToneClass(status) {
    switch (status) {
      case 'active':
        return 'text-emerald-700 dark:text-emerald-400';
      case 'recent':
        return 'text-sky-700 dark:text-sky-400';
      case 'cooling':
        return 'text-amber-700 dark:text-amber-400';
      case 'stale':
      case 'dormant':
      case 'none':
        return 'text-rose-700 dark:text-rose-400';
      default:
        return 'text-brand-muted dark:text-slate-400';
    }
  }

  global.__reviewFreshness = {
    parseReviewDate: parseReviewDate,
    labelReviewFreshness: labelReviewFreshness,
    freshnessToneClass: freshnessToneClass,
    formatDaysAgo: formatDaysAgo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
