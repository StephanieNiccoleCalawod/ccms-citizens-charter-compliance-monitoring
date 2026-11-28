// The real PUP Quezon City contact details for the public footer and the privacy notice (given by the PM, S8-16 / D8-12).
export const CONTACT = Object.freeze({
  university: 'Polytechnic University of the Philippines, Quezon City Campus',
  email: 'quezoncity@pup.edu.ph',
  phone: '282878204',
  address: 'Don Fabian St., Commonwealth, Quezon City, Philippines',
  website: 'https://www.pup.edu.ph/quezoncity/',
});

export const APPROVED_CHARTER_URL = 'https://drive.google.com/file/d/0B1BuDAuN0r8SbmFEU1RJUDFYU1E/view?usp=drivesdk&resourcekey=0-ntyYkBAnyIFKdRJWhiKEcw';

/** PM-approved published link. Add the edition to the note when the client confirms it. */
export function charterReference(env = process.env) {
  const url = String(env.NEXT_PUBLIC_CHARTER_URL ?? APPROVED_CHARTER_URL).trim();
  const edition = String(env.NEXT_PUBLIC_CHARTER_EDITION ?? '').trim();
  if (!/^https:\/\//.test(url)) return null;
  return { url, edition, note: edition
    ? `Standards follow the PUP Citizen's Charter, ${edition}.`
    : "Standards follow the PUP Citizen's Charter." };
}

export const PRIVACY_PATH = '/privacy';
export const copyrightLine = (year = new Date().getFullYear()) => `© ${year} ${CONTACT.university}. All rights reserved.`;
