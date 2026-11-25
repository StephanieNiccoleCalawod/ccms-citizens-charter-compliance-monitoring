import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { CONTACT, charterReference, copyrightLine } from '../../src/lib/constants/contact.js';

const read = (p) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8');

describe('S8-16 public footer and privacy notice', () => {
  it('has the real contact details', () => {
    assert.equal(CONTACT.email, 'quezoncity@pup.edu.ph');
    assert.match(CONTACT.address, /Don Fabian St\., Commonwealth, Quezon City/);
    assert.equal(CONTACT.website, 'https://www.pup.edu.ph/quezoncity/');
  });
  it('shows the Charter link only when both the exact link and the edition are set', () => {
    assert.equal(charterReference({}), null);
    assert.equal(charterReference({ NEXT_PUBLIC_CHARTER_URL: 'https://example.edu/charter' }), null);
    assert.equal(charterReference({ NEXT_PUBLIC_CHARTER_URL: 'http://insecure', NEXT_PUBLIC_CHARTER_EDITION: '2025' }), null);
    const ok = charterReference({ NEXT_PUBLIC_CHARTER_URL: 'https://example.edu/charter', NEXT_PUBLIC_CHARTER_EDITION: '2nd Edition, 2025' });
    assert.equal(ok.note, "Standards follow the PUP Citizen's Charter, 2nd Edition, 2025.");
  });
  it('a copyright line, and no social media or tracker in the footer (source check)', () => {
    assert.match(copyrightLine(2026), /^© 2026 Polytechnic University/);
    const footer = read('components/layout/PublicFooter.js');
    assert.doesNotMatch(footer, /facebook|twitter|instagram|youtube|google-analytics|gtag|<script|<iframe/i);
    assert.match(footer, /PRIVACY_PATH/);
  });
  it('the privacy page says what is collected, why, who sees it, how long and who to ask', () => {
    const page = read('app/privacy/page.js');
    for (const t of ['What data we collect', 'Why we collect it', 'Who can see it', 'How long we keep it', 'Who to contact about privacy', 'RA 10173']) assert.ok(page.includes(t), t);
    assert.match(page, /still being confirmed/);
    assert.doesNotMatch(page, /\b5 years\b/);
  });
  it('the public pages use the footer', () => {
    for (const f of ['components/public/LandingHero.js', 'components/public/PublicDirectory.js', 'components/ratings/RatePage.js', 'components/complaints/ComplaintForm.js']) assert.match(read(f), /<PublicFooter \/>/, f);
  });
});
