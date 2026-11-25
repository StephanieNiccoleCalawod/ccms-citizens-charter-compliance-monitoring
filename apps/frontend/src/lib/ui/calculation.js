// S8-46: the words of the "How is this calculated?" panel. Display only: it reads the `calculations` entries the services send
// (what_it_shows, how_it_is_computed, data_used, method, parameters, last_run_at) and never calculates a figure itself.
// Model names (Holt-Winters, logistic regression, IQR) are allowed here, inside the panel, and nowhere else on the screen.
import { formatDateRange, formatDateTime } from './date-format.js';

export const CALCULATION_TITLE = 'How is this calculated?';
export const CALCULATION_UNAVAILABLE = 'The explanation for this figure is not available yet.';

const SOURCES = Object.freeze({
  analytics_transactions: 'Completed and open transactions kept for analytics',
  forecast_runs: 'The saved request forecast',
  late_risk_runs: 'The saved late-risk model',
  late_risk_score_cache: 'The last saved late-risk scores',
  ratings: 'Ratings submitted with a rating code',
});

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const isCount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** 'minimum_cell_completed' -> 'Minimum cell completed'. */
export function parameterLabel(key) {
  const words = String(key ?? '').replaceAll('_', ' ').replace(/\s+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

function parameterValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString('en-PH');
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return null; // objects, arrays, null: not printed
}

/**
 * What the panel shows for one `calculations` entry, or null when the entry is missing or unusable.
 * { shows, steps, data: [{ label, value }], method, parameters: [{ label, value }], lastRun }
 */
export function calculationView(calc) {
  if (!calc || typeof calc !== 'object') return null;
  const shows = text(calc.what_it_shows);
  const steps = Array.isArray(calc.how_it_is_computed) ? calc.how_it_is_computed.map(text).filter(Boolean) : [];
  if (!shows && steps.length === 0) return null;

  const used = calc.data_used && typeof calc.data_used === 'object' ? calc.data_used : {};
  const data = [];
  data.push({ label: 'Records used', value: isCount(used.record_count) ? used.record_count.toLocaleString('en-PH') : 'Not counted for this figure' });
  const period = formatDateRange(used.period_from, used.period_to);
  data.push({ label: 'Dates', value: period || 'No dates recorded' });
  if (text(used.date_basis)) data.push({ label: 'Dates are based on', value: text(used.date_basis) });
  if (text(used.source)) data.push({ label: 'Records come from', value: SOURCES[used.source] ?? parameterLabel(used.source) });

  const parameters = Object.entries(calc.parameters && typeof calc.parameters === 'object' ? calc.parameters : {})
    .map(([key, value]) => ({ label: parameterLabel(key), value: parameterValue(value) }))
    .filter((p) => p.label && p.value !== null);

  return {
    shows,
    steps,
    data,
    method: text(calc.method),
    parameters,
    lastRun: formatDateTime(calc.last_run_at),
  };
}

/** The entry for one Charter/late-rate cell, found by office and service in a list of per-cell entries. */
export function findCellCalculation(list, officeId, serviceId) {
  if (!Array.isArray(list)) return null;
  return list.find((c) => c?.office_id === officeId && c?.service_id === serviceId) ?? null;
}

/** The entry for one service or office group in a list of { service_id | office_id, calculations } rows. */
export function findGroupCalculation(list, key, id, name) {
  if (!Array.isArray(list)) return null;
  const row = list.find((c) => c?.[key] === id);
  return row?.calculations?.[name] ?? null;
}

/**
 * One explanation for a chart made of many parts (months, offices, cells): the first part's words, the records of all parts added
 * together and the whole period from the earliest start to the latest end. Parts without a count add nothing. null when no part has an explanation.
 */
export function combineCalculations(list) {
  const parts = (Array.isArray(list) ? list : []).filter((c) => c && typeof c === 'object' && c.data_used);
  if (parts.length === 0) return null;
  const counts = parts.map((c) => c.data_used.record_count).filter(isCount);
  const froms = parts.map((c) => c.data_used.period_from).filter(Boolean).sort();
  const tos = parts.map((c) => c.data_used.period_to).filter(Boolean).sort();
  const first = parts[0];
  return {
    ...first,
    data_used: {
      ...first.data_used,
      record_count: counts.length ? counts.reduce((sum, n) => sum + n, 0) : null,
      period_from: froms[0] ?? null,
      period_to: tos.at(-1) ?? null,
    },
  };
}
