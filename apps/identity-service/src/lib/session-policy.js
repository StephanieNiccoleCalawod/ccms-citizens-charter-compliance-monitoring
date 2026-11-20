import { ROLES, ROLE_LABELS } from 'ccms-shared';

// S8-33 / S8-34 (BE): how long a password sign-in may sit idle and how long it may last in total, per role.
// Defaults are the PROPOSED values from the Sprint 8 backlog (D8-04); they apply only when SESSION_POLICY_ENABLED=true (off by default).
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
