// The "Connected systems" panel on the Calendar page, the parts that are not React: one card per system with a status badge and a plain
// sentence, and the "Sync activity" count. Pure functions, tested without a browser. The facts come from GET /sync/status
// (fms_last_push, sms_last_received, sms_issue, recent); every sentence is fixed here, nothing from the service is printed.
import { smsSyncNotice } from '../api/calendar.js';
import { EXTERNAL_SYSTEMS } from '../constants/brand.js';
import { formatDateTime } from './date-format.js';

/** Badge tones: green = fine, amber = waiting, red = needs attention. Each is used with a word, never colour alone. */
export const TONES = Object.freeze({
  good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
  waiting: 'border-amber-500/40 bg-amber-500/10 text-amber-800',
  bad: 'border-red-500/40 bg-red-500/10 text-red-700',
});
/** The left edge of a card: red when something failed, green when fine, grey otherwise. */
export const ACCENTS = Object.freeze({ good: 'border-l-emerald-600', waiting: 'border-l-slate-300', bad: 'border-l-red-600' });

const when = (value) => `${formatDateTime(value) || '-'} (Asia/Manila)`;

/** The Syllabus Management System: received data, never got any, or refusing / failing. */
export function smsCard(status) {
  const base = { id: 'sms', title: EXTERNAL_SYSTEMS.SMS.fullName, short: EXTERNAL_SYSTEMS.SMS.short, testId: 'audit-sync', lastSent: null };
  const notice = smsSyncNotice(status);
  if (notice) {
    return { ...base, testId: 'sms-notice', tone: 'bad', badge: notice.state === 'KEY_REJECTED' ? 'Key refused' : 'Failed', text: notice.text, noticeState: notice.state };
  }
  const received = status?.sms_last_received ?? status?.audit_last_synced ?? null;
  if (received) return { ...base, tone: 'good', badge: 'Synced', text: `Last received data: ${when(received)}.` };
  return { ...base, tone: 'waiting', badge: 'Not synced yet', text: 'Hasn\'t received any data yet. It will get the calendar on the next send.' };
}

/** The Faculty Management System: from the last push. */
export function fmsCard(status) {
  const base = { id: 'fms', title: EXTERNAL_SYSTEMS.FMS.fullName, short: EXTERNAL_SYSTEMS.FMS.short, testId: 'fms-push' };
  const push = status?.fms_last_push ?? null;
  if (!push) return { ...base, tone: 'waiting', badge: 'Not synced yet', text: 'Nothing has been sent yet. It will get the calendar on the next send.', lastSent: null };
  const lastSent = `Last sent ${when(push.at)}`;
  if (push.error_code === 'KEY_REJECTED') return { ...base, tone: 'bad', badge: 'Key refused', noticeState: 'KEY_REJECTED',
    text: 'FMS refused the integration key. Automatic retries have stopped. Update the key, then retry the stopped sync row.', lastSent };
  if (push.status === 'FAILED') return { ...base, tone: 'bad', badge: 'Failed', text: 'The last send failed. It will retry automatically, and your changes are saved.', lastSent };
  if (push.status === 'SENT' || push.status === 'ACKNOWLEDGED') return { ...base, tone: 'good', badge: 'Synced', text: 'The last send went through.', lastSent };
  return { ...base, tone: 'waiting', badge: 'Pending', text: 'A send is waiting. It will go out automatically.', lastSent };
}

/** Both cards, SMS first. */
export const systemCards = (status) => [smsCard(status), fmsCard(status)];

/** "8 events", "1 event", "0 events". */
export const eventCount = (recent) => {
  const n = Array.isArray(recent) ? recent.length : 0;
  return `${n} ${n === 1 ? 'event' : 'events'}`;
};
