import { Errors } from 'ccms-shared';

export const SERVICE_HAS_NO_FEE = 'This service has no fee, so proof of payment cannot be attached.';

/**
 * S8-58 (D-AC-7): proof of payment is accepted only for a service that charges a fee. The answer comes from Core, never from the
 * request. An older Core that does not send the field keeps today's behaviour (allowed); a Core that cannot be reached is a 503.
 */
export async function assertServiceHasFee(core, serviceId, asOf) {
  let data;
  try {
    data = await core.standardAsOf(serviceId, asOf);
  } catch {
    throw Errors.unavailable('Cannot check whether this service has a fee. Please try again.', 'SERVICE_FEE_UNAVAILABLE');
  }
  if (data?.has_fee === false) throw Errors.conflict(SERVICE_HAS_NO_FEE, 'SERVICE_HAS_NO_FEE');
}
