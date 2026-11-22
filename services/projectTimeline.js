/**
 * Estimated project Gantt timeline for Reviews member-app jobs.
 * PNW trade-duration defaults (confirm on site) — kitchen remodel template
 * mirrors the HomeElk estimated timeline pattern (parallel MEP trades).
 */

const MAX_STEPS = 40;
const STEP_ID_RE = /^[a-z][a-z0-9_-]{0,40}$/i;

const COLORS = {
  rose: '#fb7185',
  orange: '#fb923c',
  amber: '#fbbf24',
  lime: '#a3e635',
  emerald: '#34d399',
  teal: '#2dd4bf',
  sky: '#38bdf8',
  blue: '#60a5fa',
  indigo: '#818cf8',
  violet: '#a78bfa',
  fuchsia: '#e879f9',
  slate: '#94a3b8',
};

/**
 * Kitchen remodel default — sequential with MEP (plumbing/electrical/HVAC)
 * sharing one rough-in window.
 */
const KITCHEN_REMODEL_TEMPLATE = [
  { id: 'demo', label: 'Demo / Haul-off', detail: 'Demo existing kitchen', description: 'Protect floors, remove cabinetry and appliances, haul debris.', daysMin: 1, daysMax: 2, color: COLORS.rose },
  { id: 'framing', label: 'Framing / Carpentry', detail: 'Open walls & framing', description: 'Alter walls, headers, and blocking for new layout.', daysMin: 2, daysMax: 3, color: COLORS.orange },
  { id: 'framing_insp', label: 'Framing Inspection', detail: 'City framing inspection', description: 'Schedule and pass framing inspection before rough-ins.', daysMin: 1, daysMax: 1, color: COLORS.lime, inspection: true },
  { id: 'plumbing', label: 'Plumbing', detail: 'Rough plumbing', description: 'Supply, drain, and fixture rough-in.', daysMin: 2, daysMax: 3, color: COLORS.blue, parallelGroup: 'mep' },
  { id: 'electrical', label: 'Electrical', detail: 'Rough electrical', description: 'New circuits, boxes, and lighting rough-in.', daysMin: 2, daysMax: 3, color: COLORS.amber, parallelGroup: 'mep' },
  { id: 'hvac', label: 'HVAC', detail: 'HVAC adjustments', description: 'Duct or vent changes for the new layout.', daysMin: 1, daysMax: 2, color: COLORS.orange, parallelGroup: 'mep' },
  { id: 'rough_insp', label: 'Rough-in Inspection', detail: 'MEP rough inspection', description: 'Plumbing, electrical, and mechanical inspection.', daysMin: 1, daysMax: 1, color: COLORS.lime, inspection: true },
  { id: 'insulation', label: 'Insulation', detail: 'Insulate open walls', description: 'Batt or spray insulation where walls were opened.', daysMin: 1, daysMax: 1, color: COLORS.teal },
  { id: 'drywall', label: 'Drywall', detail: 'Hang, tape & texture', description: 'Close walls and prep for paint.', daysMin: 4, daysMax: 6, color: COLORS.slate },
  { id: 'cabinetry', label: 'Cabinetry', detail: 'Set cabinets', description: 'Install base and wall cabinets; confirm level and scribe.', daysMin: 2, daysMax: 3, color: COLORS.violet },
  { id: 'countertop', label: 'Tile Countertop', detail: 'Countertops', description: 'Template, fabricate, and set counters.', daysMin: 2, daysMax: 4, color: COLORS.indigo },
  { id: 'tile', label: 'Tile & Masonry', detail: 'Backsplash / tile', description: 'Tile backsplash and any masonry finishes.', daysMin: 2, daysMax: 3, color: COLORS.fuchsia },
  { id: 'flooring', label: 'Flooring', detail: 'Flooring install', description: 'Install finished flooring and transitions.', daysMin: 2, daysMax: 3, color: COLORS.emerald },
  { id: 'finish_carp', label: 'Finish Carpentry', detail: 'Trim & hardware', description: 'Base, casing, panels, and hardware.', daysMin: 1, daysMax: 2, color: COLORS.orange },
  { id: 'paint', label: 'Paint / Finishes', detail: 'Paint & touch-up', description: 'Prime, paint, and final finish coats.', daysMin: 2, daysMax: 3, color: COLORS.sky },
  { id: 'finish_plumb', label: 'Final Plumbing', detail: 'Set fixtures', description: 'Sink, faucet, disposal, and supply connections.', daysMin: 1, daysMax: 1, color: COLORS.blue },
  { id: 'finish_elec', label: 'Final Electrical', detail: 'Devices & lights', description: 'Switches, outlets, undercabinet, and fixtures.', daysMin: 1, daysMax: 1, color: COLORS.amber },
  { id: 'appliances', label: 'Appliance Install', detail: 'Set appliances', description: 'Install and test range, fridge, dishwasher, microwave.', daysMin: 1, daysMax: 1, color: COLORS.rose },
  { id: 'final_insp', label: 'Final Inspection', detail: 'Final walkthrough', description: 'City final and owner walkthrough punch list.', daysMin: 1, daysMax: 1, color: COLORS.lime, inspection: true },
];

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function cleanLine(v, max) {
  return String(v == null ? '' : v)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function sanitizeStep(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const idRaw = String(raw.id || `step_${index + 1}`).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  if (!STEP_ID_RE.test(idRaw)) return null;
  const daysMin = clampInt(raw.daysMin != null ? raw.daysMin : raw.days, 1, 30, 1);
  const daysMax = clampInt(raw.daysMax != null ? raw.daysMax : daysMin, daysMin, 45, daysMin);
  const color = /^#[0-9a-fA-F]{6}$/.test(String(raw.color || '')) ? String(raw.color) : COLORS.slate;
  return {
    id: idRaw,
    label: cleanLine(raw.label, 80) || `Step ${index + 1}`,
    detail: cleanLine(raw.detail, 120),
    description: cleanLine(raw.description, 280),
    daysMin,
    daysMax,
    color,
    parallelGroup: cleanLine(raw.parallelGroup, 24) || '',
    inspection: raw.inspection === true,
    done: raw.done === true,
    startDay: clampInt(raw.startDay, 0, 365, 0),
  };
}

function sanitizeSteps(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = {};
  raw.slice(0, MAX_STEPS).forEach((row, i) => {
    const step = sanitizeStep(row, i);
    if (!step || seen[step.id]) return;
    seen[step.id] = true;
    out.push(step);
  });
  return out;
}

/** Lay out startDay from sequence + parallel groups (shared window). */
function layoutSteps(steps) {
  const list = sanitizeSteps(steps);
  let cursor = 0;
  let i = 0;
  while (i < list.length) {
    const step = list[i];
    const group = step.parallelGroup;
    if (group) {
      const bundle = [];
      while (i < list.length && list[i].parallelGroup === group) {
        bundle.push(list[i]);
        i += 1;
      }
      const span = Math.max(...bundle.map((s) => s.daysMax));
      bundle.forEach((s) => {
        s.startDay = cursor;
      });
      cursor += span;
      continue;
    }
    step.startDay = cursor;
    cursor += step.daysMax;
    i += 1;
  }
  return list;
}

function buildKitchenRemodelTimeline() {
  return layoutSteps(KITCHEN_REMODEL_TEMPLATE.map((s) => ({ ...s, done: false })));
}

function pickTemplateForTitle(title) {
  const t = String(title || '').toLowerCase();
  if (/kitchen|bath|bathroom|remodel|reno|cabin|counter|tile/.test(t) || !t) {
    return buildKitchenRemodelTimeline();
  }
  return buildKitchenRemodelTimeline();
}

function summarizeTimeline(steps) {
  const list = layoutSteps(steps);
  if (!list.length) {
    return {
      steps: [],
      totalDaysMin: 0,
      totalDaysMax: 0,
      totalLabel: '',
      doneCount: 0,
      tickDays: [],
    };
  }
  const end = Math.max(...list.map((s) => s.startDay + s.daysMax));
  const minEnd = list.reduce((acc, s) => {
    const groupEnd = s.startDay + s.daysMin;
    return Math.max(acc, groupEnd);
  }, 0);
  // Better min estimate: walk same layout using daysMin
  let cursor = 0;
  let i = 0;
  while (i < list.length) {
    const group = list[i].parallelGroup;
    if (group) {
      const bundle = [];
      while (i < list.length && list[i].parallelGroup === group) {
        bundle.push(list[i]);
        i += 1;
      }
      cursor += Math.max(...bundle.map((s) => s.daysMin));
      continue;
    }
    cursor += list[i].daysMin;
    i += 1;
  }
  const totalDaysMin = cursor || minEnd;
  const totalDaysMax = end;
  const span = Math.max(totalDaysMax, 1);
  const tickEvery = span <= 10 ? 2 : span <= 20 ? 5 : 5;
  const tickDays = [];
  for (let d = 0; d <= span; d += tickEvery) tickDays.push(d);
  if (tickDays[tickDays.length - 1] !== span) tickDays.push(span);

  return {
    steps: list.map((s) => ({
      ...s,
      durationLabel: s.daysMin === s.daysMax ? `${s.daysMin} day${s.daysMin === 1 ? '' : 's'}` : `${s.daysMin}–${s.daysMax} days`,
      barLeftPct: Math.round((s.startDay / span) * 1000) / 10,
      barWidthPct: Math.max(3, Math.round((s.daysMax / span) * 1000) / 10),
      barLabel: s.daysMin === s.daysMax ? `${s.daysMax}d` : `${s.daysMin}–${s.daysMax}d`,
    })),
    totalDaysMin,
    totalDaysMax,
    totalLabel: totalDaysMin === totalDaysMax ? `~${totalDaysMax} days` : `~${totalDaysMin}–${totalDaysMax} days`,
    doneCount: list.filter((s) => s.done).length,
    tickDays,
    spanDays: span,
  };
}

function sanitizeTimeline(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const steps = layoutSteps(raw.steps);
  if (!steps.length) return null;
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.startDate || '')) ? String(raw.startDate) : '';
  const template = cleanLine(raw.template, 40) || 'kitchen_remodel';
  return {
    template,
    startDate,
    steps,
    updatedAt: Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : Date.now(),
  };
}

function presentTimeline(raw) {
  const timeline = sanitizeTimeline(raw);
  if (!timeline) return null;
  const summary = summarizeTimeline(timeline.steps);
  return {
    ...timeline,
    ...summary,
    hint: 'Overlapping bars run in parallel — plumbing, electrical & HVAC share the same window. Durations are PNW trade estimates your contractor confirms.',
  };
}

function toggleStepDone(timeline, stepId, done) {
  const next = sanitizeTimeline(timeline);
  if (!next) return null;
  const id = String(stepId || '').trim();
  next.steps = next.steps.map((s) => (s.id === id ? { ...s, done: done == null ? !s.done : !!done } : s));
  next.updatedAt = Date.now();
  return next;
}

module.exports = {
  COLORS,
  KITCHEN_REMODEL_TEMPLATE,
  MAX_STEPS,
  buildKitchenRemodelTimeline,
  pickTemplateForTitle,
  layoutSteps,
  sanitizeSteps,
  sanitizeTimeline,
  summarizeTimeline,
  presentTimeline,
  toggleStepDone,
};
