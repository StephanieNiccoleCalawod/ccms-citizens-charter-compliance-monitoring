import { ROLE_LIST } from 'ccms-shared/roles';

/** True when the user's role may open a page. No list means any signed-in role. The API checks again on the server. */
export function isRoleAllowed(user, allowedRoles) {
  return !allowedRoles || allowedRoles.includes(user.role);
}

export const ROLE_NOT_RECOGNIZED = 'ROLE_NOT_RECOGNIZED';
export const ROLE_NOT_RECOGNIZED_MESSAGE = 'Your account role is not recognized. Contact a Super Admin.';

/** True only for one of the canonical role strings (exact case). */
export function isRecognizedRole(role) {
  return typeof role === 'string' && ROLE_LIST.includes(role);
}

/**
 * The user the screens may show, from decoded token claims, or null when the claims are missing or
 * carry no recognized role. A UI safeguard only: the services authorize every request themselves.
 */
export function userFromClaims(claims) {
  if (!claims || typeof claims !== 'object' || !isRecognizedRole(claims.role)) return null;
  return {
    id: claims.sub,
    employeeNo: claims.employee_no,
    fullName: claims.full_name,
    role: claims.role,
    officeId: claims.office_id ?? null,
  };
}
