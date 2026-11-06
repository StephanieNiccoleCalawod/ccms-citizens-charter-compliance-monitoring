// One place that decides the colour of each role badge. Role values and labels come from ccms-shared; this only styles them.
// Soft tinted backgrounds with darker text of the same hue: Super Admin red, Office Head blue, Office Staff green, Executive purple.
// These are separate from the status colours (Active, Inactive), which stay in StatusBadge and are not touched here.
export const ROLE_BADGE_CLASSES = Object.freeze({
  super_admin: 'bg-[#FEE2E2] text-[#991B1B]',
  office_head: 'bg-[#DBEAFE] text-[#1D4ED8]',
  office_staff: 'bg-[#D1FAE5] text-[#047857]',
  executive: 'bg-[#F3E8FF] text-[#7E22CE]',
});

const FALLBACK = 'bg-slate-100 text-slate-700';

/** The classes for a role value; a role this app does not know gets a neutral grey. */
export const roleBadgeClasses = (role) => ROLE_BADGE_CLASSES[role] ?? FALLBACK;
