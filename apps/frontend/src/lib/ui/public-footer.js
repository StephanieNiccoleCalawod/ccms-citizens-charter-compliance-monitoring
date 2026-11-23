import { BRAND } from '../constants/brand.js';
import { DIRECTORY_PATH } from './public-directory.js';

// S8-16: the small footer of the public pages. Only real pages are listed. There is no public page for Privacy or Accessibility yet and
// no approved contact route (D8-12), so neither is shown: add them here only when they exist, never as placeholders.
export const PUBLIC_FOOTER_LINKS = [
  { href: DIRECTORY_PATH, label: 'Service directory' },
  { href: '/complaint/status', label: 'Check a complaint' },
  { href: '/complaint', label: 'File a complaint' },
  { href: '/queue/take', label: 'Take a queue number' },
];

// Approved contact route (D8-12). null until the PM confirms one; the footer shows nothing rather than made-up details.
export const PUBLIC_CONTACT = null;

// The copyright line: the year comes from the date the page runs on, so it never goes stale. The holder is the campus until D8-12 says otherwise.
export function copyrightLine(now = new Date(), holder = BRAND.campus) {
  return `\u00A9 ${now.getFullYear()} ${holder}`;
}
