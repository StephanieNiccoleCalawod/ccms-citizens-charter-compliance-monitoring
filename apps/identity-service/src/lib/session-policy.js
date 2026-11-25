import { ROLES, ROLE_LABELS } from 'ccms-shared';

// S8-33 / S8-34 (BE): how long a password sign-in may sit idle and how long it may last in total, per role.
// Defaults are the numbers APPROVED for Sprint 8 (D8-04, D8-17, D8-05): Super Admin 15 min idle / 4 h, Office Head 20 min / 8 h,
// Office Staff 30 min / 8 h, Executive 20 min / 8 h. They apply only when SESSION_POLICY_ENABLED=true (off by default until the
// deployment turns it on together with the front-end warning). Limits are read-only in Settings; nobody edits them from the screen.
// An administrator can tighten or loosen them with SESSION_POLICY_OVERRIDES, a JSON object such as
//   {"office_staff":{"idleMinutes":1,"absoluteMinutes":3}}          (accelerated limits for a local test)
// Values are bounded and there is no "never expires": an override outside the bounds is ignored and the default is used.

export const BOUNDS = Object.freeze({ idleMinutes: [1, 120], absoluteMinutes: [1, 24 * 60] });

export const DEFAULT_LIMITS = Object.freeze({
  [ROLES.SUPER_ADMIN]: Object.freeze({ idleMinutes: 15, absoluteMinutes: 4 * 60 }),
  [ROLES.OFFICE_HEAD]: Object.freeze({ idleMinutes: 20, absoluteMinutes: 8 * 60 }),
  [ROLES.OFFICE_STAFF]: Object.freeze({ idleMinutes: 30, absoluteMinutes: 8 * 60 }),
  [ROLES.EXECUTIVE]: Object.freeze({ idleMinutes: 20, absoluteMinutes: 8 * 60 }),
});

const inBounds = (value, [low, high]) => Number.isInteger(value) && value >= low && value <= high;

function parseOverrides(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The limits for one role: { idleMinutes, absoluteMinutes }. Unknown roles get the strictest default (never unlimited). */
export function limitsFor(role, env = process.env) {
  const base = DEFAULT_LIMITS[role] ?? DEFAULT_LIMITS[ROLES.SUPER_ADMIN];
  const override = parseOverrides(env.SESSION_POLICY_OVERRIDES)[role];
  const idleMinutes = inBounds(override?.idleMinutes, BOUNDS.idleMinutes) ? override.idleMinutes : base.idleMinutes;
  const absoluteMinutes = inBounds(override?.absoluteMinutes, BOUNDS.absoluteMinutes) ? override.absoluteMinutes : base.absoluteMinutes;
  // The idle limit can never be longer than the whole session.
  return { idleMinutes: Math.min(idleMinutes, absoluteMinutes), absoluteMinutes };
}

/** What Settings shows (read-only): the limits enforced for every role. */
export function policyView(env = process.env) {
  return {
    enforced: env.SESSION_POLICY_ENABLED === 'true',
    applies_to: 'Password sign-in. Clerk sign-in follows the Clerk session.',
    roles: Object.keys(DEFAULT_LIMITS).map((role) => {
      const { idleMinutes, absoluteMinutes } = limitsFor(role, env);
      return { role, role_label: ROLE_LABELS[role] ?? role, idle_minutes: idleMinutes, absolute_minutes: absoluteMinutes };
    }),
  };
}

/** What the signed-in person's own screen needs for the inactivity warning: only their role's limits. */
export function policyForRole(role, env = process.env) {
  const { idleMinutes, absoluteMinutes } = limitsFor(role, env);
  return { enforced: env.SESSION_POLICY_ENABLED === 'true', idle_minutes: idleMinutes, absolute_minutes: absoluteMinutes };
}
