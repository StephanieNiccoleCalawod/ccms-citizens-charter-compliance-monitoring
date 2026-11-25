// The real PUP Quezon City contact details for the public footer and the privacy notice (given by the PM, S8-16 / D8-12).
export const CONTACT = Object.freeze({
  university: 'Polytechnic University of the Philippines, Quezon City Campus',
  email: 'quezoncity@pup.edu.ph',
  phone: '282878204',
  address: 'Don Fabian St., Commonwealth, Quezon City, Philippines',
  website: 'https://www.pup.edu.ph/quezoncity/',
});

/**
 * The link to PUP's own published Citizen's Charter. The page is not copied here. It shows only when both the exact link and the edition
 * are set (NEXT_PUBLIC_CHARTER_URL, NEXT_PUBLIC_CHARTER_EDITION), so no link is ever added for a page that was not confirmed.
 */
export function charterReference(env = process.env) {
  const url = String(env.NEXT_PUBLIC_CHARTER_URL ?? '').trim();
  const edition = String(env.NEXT_PUBLIC_CHARTER_EDITION ?? '').trim();
  if (!/^https:\/\//.test(url) || !edition) return null;
  return { url, edition, note: `Standards follow the PUP Citizen's Charter, ${edition}.` };
}

export const PRIVACY_PATH = '/privacy';
export const copyrightLine = (year = new Date().getFullYear()) => `© ${year} ${CONTACT.university}. All rights reserved.`;
