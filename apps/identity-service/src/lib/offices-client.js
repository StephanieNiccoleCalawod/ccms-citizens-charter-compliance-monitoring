import { Errors, isUuid, serviceHeaders } from 'ccms-shared';
import { config } from './config.js';

export const OFFICE_INVALID = 'Office not found or inactive';
export const OFFICE_UNREACHABLE = 'Cannot verify office right now, try again';

async function defaultVerifyOffice(officeId, { correlationId } = {}) {
  if (!isUuid(officeId)) throw Errors.badRequest(OFFICE_INVALID, { office_id: OFFICE_INVALID }, 'OFFICE_INVALID');

  let response;
  try {
    response = await fetch(`${config.coreUrl}/offices/${officeId}`, {
      headers: serviceHeaders(correlationId),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    throw Errors.unavailable(OFFICE_UNREACHABLE, 'OFFICE_CHECK_UNAVAILABLE');
  }

  if (response.status === 404) throw Errors.badRequest(OFFICE_INVALID, { office_id: OFFICE_INVALID }, 'OFFICE_INVALID');
  // Anything else that is not a clean answer (5xx, or 401 from a misconfigured key) is "cannot verify".
  if (!response.ok) throw Errors.unavailable(OFFICE_UNREACHABLE, 'OFFICE_CHECK_UNAVAILABLE');

  const { office } = await response.json();
  if (!office?.is_active) throw Errors.badRequest(OFFICE_INVALID, { office_id: OFFICE_INVALID }, 'OFFICE_INVALID');
  return office;
}

let verifyOfficeImpl = defaultVerifyOffice;

/** Asks Core (GET /offices/:id) whether the office exists and is active. */
export function verifyOffice(officeId, options) {
  return verifyOfficeImpl(officeId, options);
}

/** Tests replace the Core call; pass null to restore the real one. */
export function setOfficeVerifier(fn) {
  verifyOfficeImpl = fn ?? defaultVerifyOffice;
}
