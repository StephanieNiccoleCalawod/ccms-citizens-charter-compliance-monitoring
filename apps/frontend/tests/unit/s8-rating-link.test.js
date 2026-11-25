import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { codeFromHash, ratingLink, ratingPlainLink } from '../../src/lib/ui/ratings.js';

describe('rating link on the receipt', () => {
  it('carries the code after the #, so it is not sent to the server', () => {
    assert.equal(ratingLink('https://cccms.pupqc.tech/', 'abcd-efgh-jkmn'), 'https://cccms.pupqc.tech/rate#ABCDEFGHJKMN');
    assert.equal(ratingPlainLink('https://cccms.pupqc.tech/'), 'https://cccms.pupqc.tech/rate');
  });
  it('reads a valid code from the hash, and nothing from a bad or empty one', () => {
    assert.equal(codeFromHash('#ABCD-EFGH-JKMN'), 'ABCDEFGHJKMN');
    assert.equal(codeFromHash('#abcdefghjkmn'), 'ABCDEFGHJKMN');
    assert.equal(codeFromHash('#short'), '');
    assert.equal(codeFromHash('#IIIIOOOO0000'), '');
    assert.equal(codeFromHash(''), '');
  });
  it('the Rate page fills the field and removes the code from the address bar (source check)', () => {
    const page = readFileSync(new URL('../../src/components/ratings/RatePage.js', import.meta.url), 'utf8');
    assert.match(page, /codeFromHash\(window\.location\.hash\)/);
    assert.match(page, /history\.replaceState\(null, '', `\$\{window\.location\.pathname\}\$\{window\.location\.search\}`\)/);
  });
  it('the printed slip has the QR, the link and the code, and the plain link stays as a fallback (source check)', () => {
    const panel = readFileSync(new URL('../../src/components/ratings/RatingCodePanel.js', import.meta.url), 'utf8');
    for (const id of ['rating-slip', 'rating-slip-code', 'rating-slip-link']) assert.ok(panel.includes(id), id);
    assert.match(panel, /RatingQr/);
  });
});
