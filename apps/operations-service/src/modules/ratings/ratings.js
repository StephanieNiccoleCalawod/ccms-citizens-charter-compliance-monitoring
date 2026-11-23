import { randomInt, randomUUID } from 'node:crypto';
import { AppError, Errors, ROLES, calculation, isUuid, toManilaDate } from 'ccms-shared';

// CC057 (spec 9.2; C-10, K24): service rating with a one-time code from the completion receipt.
//   - the code is issued when the transaction completes (issueRatingCode, inside that database transaction)
//   - a citizen rates 1 to 5 stars once per code, on a public page; no free text, nothing about the person is kept
//   - the summary (count and average per service) is read by staff and is separate from compliance figures
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
export const CODE_LENGTH = 12;
export const CODE_PATTERN = /^[A-HJ-KM-NP-Z2-9]{12}$/;
export const RATING_REFUSED = 'This code is not valid or has already been used.';
const rowsOf = (result) => (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result);

export const newRatingCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
/** Shown as XXXX-XXXX-XXXX; the dashes are optional when typed. */
export const formatCode = (code) => (code ? code.replace(/(.{4})(?=.)/g, '$1-') : null);
export const normalizeCode = (value) => String(value ?? '').toUpperCase().replace(/[\s-]/g, '');

/** Inside the completing transaction. Idempotent: a transaction has one code for life (12 characters from 31: a clash is not expected). */
export async function issueRatingCode(manager, row) {
  const [made] = rowsOf(await manager.query(
    `INSERT INTO service_ratings (rating_id, transaction_id, rating_code, office_id, service_id, service_code, service_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (transaction_id) DO UPDATE SET transaction_id = EXCLUDED.transaction_id
     RETURNING rating_code`,
    [randomUUID(), row.transaction_id, newRatingCode(), row.office_id, row.service_id, row.service_code, row.service_name]));
  return made.rating_code;
}

export async function ratingCodeFor(db, transactionId) {
  const [row] = rowsOf(await db.query('SELECT rating_code, stars FROM service_ratings WHERE transaction_id = $1', [transactionId]));
  return row ? { code: row.rating_code, used: row.stars !== null } : null;
}

/** POST /ratings { code, stars }. The same answer for a wrong code and a used one, so a code cannot be probed. */
export async function rateWithCode(db, body, { now = new Date() } = {}) {
  const code = normalizeCode(body?.code);
  const stars = body?.stars;
  const details = {};
  if (!CODE_PATTERN.test(code)) details.code = 'Enter the 12-character code from your receipt.';
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) details.stars = 'Choose 1 to 5 stars.';
  if (Object.keys(details).length) throw Errors.validation('Please correct the highlighted fields', details);
  const rows = rowsOf(await db.query(
    'UPDATE service_ratings SET stars = $2, rated_at = $3 WHERE rating_code = $1 AND stars IS NULL RETURNING service_name',
    [code, stars, now]));
  if (!rows[0]) throw new AppError(409, 'RATING_CODE_INVALID', RATING_REFUSED);
  return { rated: true, service_name: rows[0].service_name };
}

/** GET /ratings/summary?office_id=&from=&to= : count and average per service (rated only), apart from compliance. */
export async function ratingSummary(db, actor, params, now = new Date()) {
  const get = (n) => params.get(n) || undefined;
  const bound = actor.role === ROLES.OFFICE_HEAD || actor.role === ROLES.OFFICE_STAFF;
  let officeId = get('office_id');
  const from = get('from');
  const to = get('to');
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const details = {};
  if (officeId && !isUuid(officeId)) details.office_id = 'Choose a valid office.';
  if (from && !date.test(from)) details.from = 'Use YYYY-MM-DD.';
  if (to && !date.test(to)) details.to = 'Use YYYY-MM-DD.';
  if (Object.keys(details).length) throw Errors.validation('Please correct the highlighted fields', details);
  if (bound) {
    if (officeId && officeId.toLowerCase() !== String(actor.officeId).toLowerCase()) throw Errors.forbidden();
    officeId = actor.officeId;
  }
  const items = rowsOf(await db.query(
    `SELECT service_id, max(service_code) AS service_code, max(service_name) AS service_name, count(stars)::int AS count, round(avg(stars)::numeric, 2)::float AS average,
       min(rated_at) AS first_rated_at, max(rated_at) AS last_rated_at
       FROM service_ratings
      WHERE stars IS NOT NULL AND ($1::uuid IS NULL OR office_id = $1::uuid)
        AND ($2::date IS NULL OR rated_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Manila'))
        AND ($3::date IS NULL OR rated_at < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'))
      GROUP BY service_id ORDER BY max(service_name), service_id`,
    [officeId ?? null, from ?? null, to ?? null]));
  const total = items.reduce((n, i) => n + i.count, 0);
  const average = total ? Math.round((items.reduce((s, i) => s + i.average * i.count, 0) / total) * 100) / 100 : null;
  const explain = (count, first, last, method, steps) => calculation({
    shows: 'Submitted service ratings on a scale of one to five stars.', steps, count, method,
    from: from ?? (first ? toManilaDate(first) : null), to: to ?? (last ? toManilaDate(last) : null),
    source: 'service_ratings', basis: 'Submitted ratings by rated_at in Asia/Manila; unused rating codes are excluded.', at: now,
  });
  const first = items.map((i) => i.first_rated_at).filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0];
  const last = items.map((i) => i.last_rated_at).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
  return { items: items.map(({ first_rated_at, last_rated_at, ...item }) => ({ ...item,
    calculations: { ratings: explain(item.count, first_rated_at, last_rated_at, 'arithmetic mean',
      ['Select submitted ratings for the service and office in the requested dates.', 'Divide the sum of stars by the number submitted and round to two decimals.']) },
  })), total_count: total, average,
  calculations: { ratings: explain(total, first, last, 'count-weighted mean of rounded service averages',
    ['Select submitted ratings in the office and date filters.', 'Multiply each rounded service average by its count, divide their sum by the total count, and round to two decimals.']) } };
}
