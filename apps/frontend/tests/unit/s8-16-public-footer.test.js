import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PUBLIC_CONTACT, PUBLIC_FOOTER_LINKS, copyrightLine } from '../../src/lib/ui/public-footer.js';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const read = (p) => fs.readFileSync(path.join(src, p), 'utf8');

describe('S8-16 public footer', () => {
  it('lists only pages that exist (AC1)', () => {
    for (const { href } of PUBLIC_FOOTER_LINKS) {
      const dir = href === '/' ? 'app' : `app${href}`;
      assert.ok(fs.existsSync(path.join(src, dir, 'page.js')), `${href} has no page`);
    }
    assert.ok(PUBLIC_FOOTER_LINKS.length >= 2 && PUBLIC_FOOTER_LINKS.length <= 5);
  });
  it('shows no Privacy, Accessibility or contact route until one is approved', () => {
    assert.equal(PUBLIC_CONTACT, null);
    assert.ok(!PUBLIC_FOOTER_LINKS.some((l) => /privacy|accessib|contact/i.test(l.label)));
  });
  it('takes the year from the date it is given (AC2)', () => {
    assert.match(copyrightLine(new Date('2031-06-01T00:00:00')), /^\u00A9 2031 /);
    assert.ok(copyrightLine().includes(String(new Date().getFullYear())));
    assert.ok(!read('components/public/PublicFooter.js').match(/20[0-9]{2}/));
  });
  it('is on the landing page and the directory, and the directory has no second footer', () => {
    assert.ok(read('components/public/LandingHero.js').includes('<PublicFooter'));
    const dir = read('components/public/PublicDirectory.js');
    assert.ok(dir.includes('<PublicFooter'));
    assert.ok(!dir.includes('<footer'));
  });
  it('links keep a 24 px target and a visible focus ring (AC3)', () => {
    const f = read('components/public/PublicFooter.js');
    assert.ok(f.includes('min-h-6') && f.includes('focus-visible:ring-2') && f.includes('aria-label="Public pages"'));
  });
});
