import { randomInt, randomUUID } from 'node:crypto';
import { AppError, Errors, buildErrorBody, clientIp, createDbStore, createRateLimiter, isUuid, publicLimits } from 'ccms-shared';
import { getDb } from '../../lib/data-source.js';
import { getMailer } from '../../lib/mailer.js';

// CC032 / CC033: a citizen files a complaint without an account and checks its status with the reference. Oversight holds them
// (spec 8.2; ERD section 8 still to be confirmed by the team). Staff handling is Sprint 7, so a complaint is RECEIVED here and
// nothing else. A complaint is about a service of an office, never a case against a named person: the form asks for no officer.
//
// PROPOSED category list: RA 11032 Sec. 21 (acts punishable) plus Other. The codes and wording MUST be checked against the text of
// the law and PUP's Feedback and Complaints Mechanism (CC032 AC5) before the demo; changing them later is one list here.
export const COMPLAINT_CATEGORIES = Object.freeze([
  { value: 'REFUSAL_TO_ACCEPT', label: 'Refusal to accept a complete application or request' },
  { value: 'ADDITIONAL_REQUIREMENTS', label: 'Requirements added that were not in the Citizen’s Charter' },
  { value: 'ADDITIONAL_COSTS', label: 'Costs charged that are not in the Citizen’s Charter' },
  { value: 'NO_WRITTEN_NOTICE', label: 'No written notice of disapproval' },
  { value: 'DELAYED_SERVICE', label: 'Service not given within the processing time' },
  { value: 'NOT_ATTENDED', label: 'Not attended to during official hours or lunch break' },
  { value: 'NO_OFFICIAL_RECEIPT', label: 'No official receipt issued' },
  { value: 'FIXING', label: 'Fixing or dealing with fixers' },
  { value: 'OTHER', label: 'Other' },
]);
export const CATEGORY_VALUES = COMPLAINT_CATEGORIES.map((c) => c.value);
export const LIMITS = Object.freeze({ description: 2000, name: 200, email: 254, tracking: 60 });
export const STATUS_RECEIVED = 'RECEIVED';
export const RATE_LIMITED = 'Too many requests. Please wait a while and try again.';

// Letters and digits without the look-alikes (no 0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const REFERENCE_RE = /^CMP-\d{8}-[A-HJKMNP-Z2-9]{6}$/;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const makeReference = (date = new Date()) => {
  const day = date.toISOString().slice(0, 10).replaceAll('-', '');
  let code = '';
  for (let i = 0; i < 6; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return `CMP-${day}-${code}`;
};
export const isReference = (value) => typeof value === 'string' && REFERENCE_RE.test(value);

const limiters = { file: null, status: null };
const limiter = (kind) => (limiters[kind] ??= createRateLimiter({ store: createDbStore(getDb) }));
export const setLimiters = (value) => { limiters.file = value?.file ?? null; limiters.status = value?.status ?? null; };

/** Per client address. Filing is strict (PROPOSED: 5 per hour, COMPLAINT_RATE_LIMIT / COMPLAINT_RATE_WINDOW_SECONDS); status uses the public limits. */
export async function limitRequest(request, correlationId, kind, env = process.env) {
  const key = `complaints:${kind}:${clientIp(request) ?? 'unknown'}`;
  const own = kind === 'file'
    ? { limit: Number(env.COMPLAINT_RATE_LIMIT) > 0 ? Number(env.COMPLAINT_RATE_LIMIT) : 5, windowMs: (Number(env.COMPLAINT_RATE_WINDOW_SECONDS) > 0 ? Number(env.COMPLAINT_RATE_WINDOW_SECONDS) : 3600) * 1000 }
    : publicLimits(env);
  const result = await limiter(kind).check(key, own);
  if (result.allowed) return null;
  return new Response(JSON.stringify(buildErrorBody({ code: 'RATE_LIMITED', message: RATE_LIMITED, correlationId })), {
    status: 429,
    headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': String(result.retryAfterSeconds), 'cache-control': 'no-store' },
  });
}

/** Is this an active office? Asked of Core with the shared service key (Oversight keeps no office list). Core down is a 503, not a guess. */
export async function officeIsActive(officeId, { env = process.env, fetchImpl = fetch } = {}) {
  const raw = String(env.CORE_URL ?? env.CORE_SERVICE_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw || !env.SERVICE_KEY) throw new AppError(503, 'CORE_UNAVAILABLE', 'Complaints cannot be filed right now. Please try again later.');
  let response;
  try {
    response = await fetchImpl(`${raw.endsWith('/api') ? raw : `${raw}/api`}/offices/${officeId}`, { headers: { accept: 'application/json', 'x-service-key': env.SERVICE_KEY }, signal: AbortSignal.timeout(5000) });
  } catch {
    throw new AppError(503, 'CORE_UNAVAILABLE', 'Complaints cannot be filed right now. Please try again later.');
  }
  if (response.status === 404) return false;
  if (!response.ok) throw new AppError(503, 'CORE_UNAVAILABLE', 'Complaints cannot be filed right now. Please try again later.');
  const body = await response.json().catch(() => null);
  return body?.office?.is_active === true;
}

const clean = (value) => (typeof value === 'string' ? value.trim() : value);

/** Checks the body and returns the values to store. All problems are reported together, by field. */
export function validateComplaint(body) {
  const d = {};
  const officeId = clean(body?.office_id ?? body?.officeId);
  if (!isUuid(officeId)) d.office_id = 'Choose the office.';
  const category = clean(body?.category);
  if (!CATEGORY_VALUES.includes(category)) d.category = 'Choose a category.';
  const description = clean(body?.description);
  if (typeof description !== 'string' || !description) d.description = 'Describe what happened.';
  else if (description.length > LIMITS.description) d.description = `The description must be ${LIMITS.description} characters or fewer.`;
  else if (CONTROL.test(description)) d.description = 'The description contains characters that cannot be used.';
  const optional = (field, max, label, test) => {
    const raw = body?.[field];
    if (raw === undefined || raw === null || raw === '') return null;
    const value = clean(raw);
    if (typeof value !== 'string' || !value) return null;
    if (value.length > max) d[field] = `${label} must be ${max} characters or fewer.`;
    else if (CONTROL.test(value) || (test && !test(value))) d[field] = `Enter a valid ${label.toLowerCase()}.`;
    return value;
  };
  const trackingNo = optional('tracking_no', LIMITS.tracking, 'Tracking number');
  const name = optional('name', LIMITS.name, 'Name');
  const email = optional('email', LIMITS.email, 'Email', (v) => EMAIL_RE.test(v));
  if (Object.keys(d).length) throw Errors.validation('Please correct the highlighted fields.', d);
  return { officeId: officeId.toLowerCase(), category, description, trackingNo, name, email: email ? email.toLowerCase() : null };
}

const mailText = (reference) => `Your complaint has been received.\n\nReference number: ${reference}\n\nKeep this number. You can check the status of your complaint at any time with it on the CCMS website, without signing in.\n\nThis is an automatic message. Please do not reply.`;

/** POST /complaints. Returns { reference, status, email_sent }. The email never decides whether the complaint is saved. */
export async function fileComplaint(db, body, { now = new Date(), isActiveOffice = officeIsActive, mailer = null } = {}) {
  const v = validateComplaint(body);
  if (!(await isActiveOffice(v.officeId))) throw Errors.validation('Choose an active office.', { office_id: 'Choose an active office.' });
  let reference;
  for (let attempt = 0; attempt < 5 && !reference; attempt += 1) {
    const candidate = makeReference(now);
    const rows = await db.query(
      `INSERT INTO complaints (complaint_id, reference, office_id, category, description, tracking_no, complainant_name, complainant_email, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (reference) DO NOTHING RETURNING reference`,
      [randomUUID(), candidate, v.officeId, v.category, v.description, v.trackingNo, v.name, v.email, STATUS_RECEIVED, now],
    );
    const inserted = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
    if (inserted?.length) reference = candidate;
  }
  if (!reference) throw new AppError(503, 'REFERENCE_UNAVAILABLE', 'The complaint could not be saved. Please try again.');
  let emailSent = null;
  if (v.email) {
    emailSent = false;
    try {
      const m = mailer ?? getMailer();
      if (m.configured) {
        await m.send({ to: v.email, subject: `Your CCMS complaint ${reference}`, text: mailText(reference) });
        emailSent = true;
      }
    } catch (err) {
      console.warn('Complaint reference email failed:', err?.message);
    }
  }
  return { reference, status: STATUS_RECEIVED, email_sent: emailSent };
}

/** GET /complaints/status?ref=. Only the status; an unknown or malformed reference gets the same 404 and nothing else. */
export async function complaintStatus(db, ref) {
  const reference = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  const rows = isReference(reference) ? await db.query('SELECT status FROM complaints WHERE reference = $1', [reference]) : [];
  const found = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
  if (!found?.length) throw Errors.notFound('We could not find a complaint with that reference number.', 'COMPLAINT_NOT_FOUND');
  return { reference, status: found[0].status };
}
