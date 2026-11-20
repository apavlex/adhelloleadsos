/** Shared ids / normalization for chat employees (avoids circular requires). */

const DEFAULT_EMPLOYEE_ID = 'alex';

function normalizeEmployeeId(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (id === 'grok' || id === 'grok-bot') return 'grokbot';
  return id;
}

module.exports = {
  DEFAULT_EMPLOYEE_ID,
  normalizeEmployeeId,
};
