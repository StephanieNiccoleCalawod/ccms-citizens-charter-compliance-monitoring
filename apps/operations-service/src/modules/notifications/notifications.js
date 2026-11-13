import { Errors, ROLES, isUuid } from 'ccms-shared';
import { readLateRisk } from '../analytics/late-risk.js';

// Sprint 7 CC055: the Operations half of the notification bell, worked out each time it is asked for from the late-risk scores of the
// office's open transactions (nothing is stored). One notice per transaction and kind:
//   overdue     the working-time limit is used up (nothing left)
//   deadline    80% or more of the limit is used and some is left
//   high_risk   the late-risk level is High (not for an overdue one: that is already its own notice)
// A person sees only the transactions they may open (Office Staff: their own; Office Head: the office). The Super Admin has no office of
// their own, so gets notices only when an officeId is given. The Executive has no bell. Read marks are kept by Oversight.
export const DEADLINE_SHARE = 0.8;
const TEXT = {
  overdue: (i) => `${i.tracking_no} (${i.service_name}) has used all of its time limit.`,
  deadline: (i) => `${i.tracking_no} (${i.service_name}) has used ${Math.round(i.share_used * 100)}% of its time limit.`,
  high_risk: (i) => `${i.tracking_no} (${i.service_name}) is at high risk of being late.`,
};

export function notificationsFromRisk(items, { now = new Date() } = {}) {
  const out = [];
  for (const item of items) {
    if (item.can_open === false) continue;
    const base = { office_scope: 'OFFICE', transaction_id: item.transaction_id, href: `/transactions/${item.transaction_id}`, at: now.toISOString() };
    const add = (kind) => out.push({ ...base, key: `${kind}:${item.transaction_id}`, kind: kind.toUpperCase(), text: TEXT[kind](item) });
    if (item.working_minutes_left === 0) add('overdue');
    else if (typeof item.share_used === 'number' && item.share_used >= DEADLINE_SHARE) add('deadline');
    if (item.level === 'HIGH' && item.working_minutes_left !== 0) add('high_risk');
  }
  const rank = { OVERDUE: 0, DEADLINE: 1, HIGH_RISK: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.key.localeCompare(b.key));
}

export async function listOperationsNotifications(db, actor, { officeId = null, now = new Date(), readRisk = readLateRisk } = {}) {
  if (actor.role === ROLES.EXECUTIVE) throw Errors.forbidden();
  let office = actor.role === ROLES.SUPER_ADMIN ? officeId : actor.officeId;
  if (officeId && !isUuid(officeId)) throw Errors.validation('Choose a valid office.', { officeId: 'Choose a valid office.' });
  if (actor.role !== ROLES.SUPER_ADMIN && officeId && officeId.toLowerCase() !== String(actor.officeId).toLowerCase()) throw Errors.forbidden();
  if (!office) return { items: [], generated_at: now.toISOString() };
  office = String(office).toLowerCase();
  const risk = await readRisk(db, office, actor, { now });
  return { items: notificationsFromRisk(risk.items, { now }), generated_at: now.toISOString() };
}
