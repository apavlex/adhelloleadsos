/** Permit Stack search categories (matches permit-stack.com/search UI). */

const PERMIT_STACK_CATEGORIES = [
  { value: '', label: 'All categories' },
  { value: 'solar', label: 'Solar' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'new_construction', label: 'New Construction' },
  { value: 'demolition', label: 'Demolition' },
  { value: 'renovation', label: 'Renovation' },
  { value: 'addition', label: 'Addition' },
  { value: 'fence', label: 'Fence' },
  { value: 'pool', label: 'Pool' },
  { value: 'ev_charger', label: 'EV Charger' },
  { value: 'fire_alarm', label: 'Fire Alarm' },
  { value: 'sign', label: 'Sign' },
];

function normalizePermitCategory(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const slug = raw.replace(/\s+/g, '_').replace(/-/g, '_');
  const match = PERMIT_STACK_CATEGORIES.find((c) => c.value && (c.value === slug || c.label.toLowerCase().replace(/\s+/g, '_') === slug));
  return match ? match.value : slug;
}

module.exports = {
  PERMIT_STACK_CATEGORIES,
  normalizePermitCategory,
};
