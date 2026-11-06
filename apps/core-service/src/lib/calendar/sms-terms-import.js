import { SYSTEM_ACTOR } from './holiday-import.js';
import { buildTermSnapshot, enqueueTermSnapshot, smsTermCode } from './sms-snapshot.js';
import { fetchSmsTerms, termsEnabled } from './sms-terms-client.js';
import { createTerm, listTerms, updateTerm } from './terms.js';

// SMS owns the academic terms. CCMS keeps a copy of them in its own term list (term_dates) because the snapshot sent to SMS and
// the calendar SMS pulls are both built per term from that list. With SMS_TERMS_ENABLED=true the daily calendar-sync job calls
// importSmsTerms before it pushes anything:
//   - a term SMS has and CCMS does not is added, with the SMS term code as its name (2026-1S, 2026-2S, 2026-MIDYEAR);
//   - a term CCMS already has (same code; 2026-MY counts as 2026-MIDYEAR) gets SMS's dates when they differ;
//   - calendar entries inside a new or changed term are queued for SMS as a fresh snapshot in the same transaction, so an entry
//     saved before its term existed is sent now without being edited;
//   - a term that would overlap another stored term is skipped and reported, never forced;
//   - a stored term SMS does not list is left alone and reported (nothing is ever deleted here).
// Nothing from SMS's answer other than the term code and the two dates is stored or reported.
const VALID_CODE = /^\d{4}-(1S|2S|MIDYEAR)$/;

export async function importSmsTerms(dataSource, { env = process.env, fetchImpl = fetch, actor = SYSTEM_ACTOR, log = () => {} } = {}) {
  if (!termsEnabled(env)) return { skipped: true, reason: 'SMS_TERMS_ENABLED is not true' };

  let fetched;
  try {
    fetched = await fetchSmsTerms({ env, fetchImpl });
  } catch (error) {
    return { skipped: false, state: error?.code === 'KEY_REJECTED' ? 'KEY_REJECTED' : 'UNAVAILABLE' };
  }
  if (fetched.skipped) return { skipped: false, state: 'NOT_CONFIGURED' };

  const result = { skipped: false, state: 'OK', added: [], updated: [], unchanged: 0, conflicts: [], invalid: [], not_in_sms: [] };
  const stored = await listTerms(dataSource);
  const seen = new Set();

  for (const term of fetched.terms) {
    const code = term.termCode;
    if (!VALID_CODE.test(String(code ?? '')) || seen.has(code)) {
      result.invalid.push(code ?? null);
      continue;
    }
    seen.add(code);
    const existing = stored.find((row) => smsTermCode(row.term_name) === code);
    const dates = { start_date: term.startDate, end_date: term.endDate };
    // The new or changed term gets a fresh snapshot of the entries inside it. A brand-new term with no entries queues nothing.
    const queue = (isNew) => async (manager, saved) => {
      const row = { term_id: saved.term_id, term_name: saved.term_name, start_date: saved.start_date, end_date: saved.end_date };
      if (isNew && (await buildTermSnapshot(manager, row)).items.length === 0) return;
      await enqueueTermSnapshot(manager, row);
    };
    try {
      if (!existing) {
        await createTerm(dataSource, actor, { term_name: code, ...dates }, { fromSms: true, inTransaction: queue(true) });
        result.added.push(code);
        log(`add ${code}`);
      } else if (existing.start_date === dates.start_date && existing.end_date === dates.end_date) {
        result.unchanged += 1;
      } else {
        await updateTerm(dataSource, actor, existing.term_id, { term_name: existing.term_name, ...dates }, { fromSms: true, inTransaction: queue(false) });
        result.updated.push(code);
        log(`update ${code}`);
      }
    } catch (error) {
      // Only a fixed reason is kept, never the text of an error.
      if (error?.code === 'TERM_OVERLAP') result.conflicts.push({ term_code: code, reason: 'OVERLAPS_ANOTHER_STORED_TERM' });
      else result.invalid.push(code);
    }
  }

  for (const row of stored) {
    const code = smsTermCode(row.term_name);
    if (!code || !seen.has(code)) result.not_in_sms.push(row.term_name);
  }
  return result;
}
