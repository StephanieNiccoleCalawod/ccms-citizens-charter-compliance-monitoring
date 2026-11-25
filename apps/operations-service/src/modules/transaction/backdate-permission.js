import { Errors, ROLES } from 'ccms-shared';

export const OFFICE_BACKDATE_DENIED = 'This office is not allowed to record past transactions. Please ask the Super Admin.';

// D-AC-5: Super Admin is exempt. Everyone else needs an explicit permission from Core, not caller input.
export async function assertOfficeBackdateAllowed(core, user, officeId) {
  if (user.role === ROLES.SUPER_ADMIN) return;
  let office;
  try {
    office = await core.office(officeId);
    if (!office || office.office_id?.toLowerCase() !== officeId.toLowerCase() ||
        typeof office.is_active !== 'boolean' ||
        (office.allow_backdated_transactions !== undefined && typeof office.allow_backdated_transactions !== 'boolean')) {
      throw new Error('Invalid office permission response');
    }
  } catch {
    throw Errors.unavailable('Cannot verify this office’s permission to record past transactions. Please try again.', 'OFFICE_BACKDATE_PERMISSION_UNAVAILABLE');
  }
  // Missing field from an older Core is off, never permission to bypass the restriction.
  if (!office.is_active || office.allow_backdated_transactions !== true) {
    throw Errors.forbidden(OFFICE_BACKDATE_DENIED, 'OFFICE_BACKDATE_NOT_ALLOWED');
  }
}
