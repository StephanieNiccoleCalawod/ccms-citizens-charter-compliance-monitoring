// S8 flags 4 to 6 of the unusual-case table and the Client Satisfaction tab. Pure helpers: the server decides every flag, these only
// scope and word them. Satisfaction is how clients rated the service; it is not timeliness and is never mixed with the late rate.
import { filterScopedUnusual } from './insights.js';

export const SATISFACTION_NOTE = 'Satisfaction, not timeliness: this is how clients rated the service, not how fast it was done.';
export const NOT_ENOUGH_RATINGS = 'Not enough ratings yet';
export const MIN_RATINGS = 10;

export const FLAG_TEXT = Object.freeze({
  HOLD_LONG: 'Held for more than one working day',
  MANY_CANCELLED: 'More cancelled or auto-closed than usual',
  LOW_RATING: 'Average rating below 3.0',
});

export const holdMinutesText = (minutes) => {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60); const r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
};
export const starsText = (average) => (average == null ? '-' : `${Number(average).toFixed(1)} / 5`);
export const rateText = (rate) => (rate == null ? '-' : `${Number(rate).toFixed(rate % 1 ? 1 : 0)}%`);

export function scopedCaseFlags(overview, scope) {
  const charter = overview?.charter ?? {};
  return {
    holds: filterScopedUnusual(charter.long_holds, scope),
    cancellations: filterScopedUnusual(charter.many_cancelled, scope),
  };
}

/** Rating rows inside the scope, with the flag and the "not enough yet" state. */
export function satisfactionRows(items = [], scope = { kind: 'campus', officeId: null }) {
  const list = filterScopedUnusual(items, scope);
  return list.map((i) => ({ ...i, low: (i.flags ?? []).includes('LOW_RATING'), enough: i.enough_ratings === true }))
    .sort((a, b) => Number(b.low) - Number(a.low) || String(a.service_name).localeCompare(String(b.service_name)));
}

export const lowRatingRows = (items, scope) => satisfactionRows(items, scope).filter((r) => r.low);
/** The Client Satisfaction tab shows only when at least one rating was submitted in the period. */
export const hasSatisfaction = (items = []) => Array.isArray(items) && items.some((i) => Number(i?.count) > 0);

export function withSatisfactionTab(tabs, show, lowCount = 0) {
  if (!show) return tabs;
  return [...tabs, { id: 'satisfaction', label: 'Client Satisfaction', badge: String(lowCount), badgeTone: lowCount > 0 ? 'gold' : 'neutral' }];
}
