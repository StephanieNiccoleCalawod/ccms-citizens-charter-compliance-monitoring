// S8-35 (FE): plain words on every screen.
//   AC2  no primary screen shows an internal code or a raw error
//   AC3  no queued or unconfirmed action shows a success message
// plus the partner system is called SCMS everywhere (defect #13). The glossary itself (D8-16) is a draft for the PM: docs/ux-glossary-D8-16-draft.md.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { MESSAGES, isSafeText, plainFailure } from '../../src/lib/ui/save-feedback.js';
import { EXTERNAL_SYSTEMS } from '../../src/lib/constants/brand.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const rel = (f) => relative(ROOT, f).split(sep).join('/');
const screens = walk(join(ROOT, 'src')).filter((f) => /[\\/](app|components)[\\/]/.test(f) && f.endsWith('.js'));
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const apiError = (status, code, message = 'x') => Object.assign(new Error(message), { name: 'ApiError', status, code });

describe('a failed request says what happened, whether anything changed, and what to do (AC2)', () => {
  const fallback = 'The receipt could not be deleted, so it is still on file. Please try again.';

  it('a server problem, a timeout and an outage never reach the screen as the server\'s own text', () => {
    assert.equal(plainFailure(apiError(500, 'INTERNAL', 'pg: relation "x" does not exist'), { fallback, writes: true }), fallback);
    assert.equal(plainFailure(apiError(500, 'X', 'Jest worker encountered 2 child process exceptions'), { fallback }), fallback);
    assert.equal(plainFailure(apiError(504, 'GATEWAY_TIMEOUT', 'Gateway Timeout'), { fallback, writes: true }), MESSAGES.gateway);
    assert.match(plainFailure(apiError(504, 'GATEWAY_TIMEOUT'), { fallback }), /did not answer in time\. Please try again/);
    assert.equal(plainFailure(apiError(503, 'X'), { fallback, writes: true }), MESSAGES.unavailable);
    assert.match(plainFailure(apiError(503, 'X'), { fallback }), /temporarily unavailable\. Please try again/);
  });

  it('no connection and no permission each say so, and say that nothing was changed when a change was attempted', () => {
    assert.equal(plainFailure({ code: 'NETWORK_ERROR', message: 'x' }, { fallback, writes: true }), 'Unable to connect to the server. Nothing was changed. Please check your connection and try again.');
    assert.equal(plainFailure({ code: 'NETWORK_ERROR', message: 'x' }, { fallback }), 'Unable to connect to the server. Please check your connection and try again.');
    assert.equal(plainFailure(apiError(403, 'FORBIDDEN'), { fallback, writes: true }), `${MESSAGES.unauthorized} Nothing was changed.`);
    assert.equal(plainFailure(apiError(401, 'X'), { fallback }), 'You do not have access to this.');
  });

  it('a plain sentence from the server for a refused request (4xx) is kept; anything that looks like internals is replaced', () => {
    assert.equal(plainFailure(apiError(409, 'INVALID_STATE', 'This transaction is no longer pending.'), { fallback }), 'This transaction is no longer pending.');
    assert.equal(plainFailure(apiError(400, 'X', 'TypeError: x is undefined'), { fallback }), fallback);
    assert.equal(plainFailure(apiError(404, 'X', 'at Object.run (D:\\app\\route.js:12:3)'), { fallback }), fallback);
    assert.equal(plainFailure(apiError(400, 'X', ''), { fallback }), fallback);
    assert.equal(plainFailure(undefined, { fallback }), fallback);
    assert.equal(isSafeText('Office code already exists'), true);
  });

  it('every fallback sentence names the thing and gives one next step', () => {
    const calls = [];
    for (const file of screens) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/plainFailure\([^)]*?fallback: '([^']+)'/g)) calls.push([rel(file), m[1]]);
    }
    assert.ok(calls.length >= 10, `${calls.length} fallbacks found`);
    for (const [file, sentence] of calls) assert.match(sentence, /(Please try again|try again|Sign out and sign in)/i, `${file}: "${sentence}"`);
  });

  it('no screen puts a server message straight on screen any more', () => {
    const offenders = [];
    for (const file of screens) {
      const code = strip(readFileSync(file, 'utf8'));
      // setError(err.message) / setBanner(err.message) / notify.error(err.message): the raw text. The sign-in page keeps its own fixed messages.
      for (const m of code.matchAll(/(?:setError|setBanner|notify\.error)\(\s*(?:err|error|failure)\??\.message\s*\)/g)) offenders.push(`${rel(file)}: ${m[0]}`);
      for (const m of code.matchAll(/(?:setError|setBanner|notify\.error)\(\s*(?:err|error|failure)\??\.message\s*(?:\|\||\?\?)/g)) offenders.push(`${rel(file)}: ${m[0]}`);
    }
    const allowed = ['src/app/login/page.js'];
    assert.deepEqual(offenders.filter((o) => !allowed.some((a) => o.startsWith(a))), []);
  });

  it('no internal ticket code or technical term appears in text a person reads', () => {
    const hits = [];
    for (const file of screens) {
      const code = strip(readFileSync(file, 'utf8'));
      for (const m of code.matchAll(/['"`>]([^'"`<>\n]*\b(?:CC0\d{2}|DEF-\d+|S8-\d+|claim_token|issuer|M\d{1,2}-\d+)\b[^'"`<>\n]*)['"`<]/g)) hits.push(`${rel(file)}: ${m[1].trim().slice(0, 60)}`);
    }
    assert.deepEqual(hits, []);
  });
});

describe('no queued or unconfirmed action shows a success message (AC3)', () => {
  // Each success sentence must follow an awaited request in the same function: it says "done" only after the server answered.
  // The queue screen's sample preview is a local view (no request exists), and is listed here on purpose.
  const LOCAL_ONLY = new Set(['src/components/queue/QueuePanel.js']);

  it('every notify.success / success banner comes after an awaited request, never straight from a click', () => {
    const offenders = [];
    for (const file of screens) {
      if (LOCAL_ONLY.has(rel(file))) continue;
      const s = readFileSync(file, 'utf8');
      for (const m of s.matchAll(/notify\.success\(|variant: 'success', message/g)) {
        const before = s.slice(Math.max(0, m.index - 1200), m.index);
        const start = Math.max(before.lastIndexOf('async function'), before.lastIndexOf('=> {'), before.lastIndexOf('function '));
        const scope = before.slice(Math.max(start, 0));
        // TransactionDetail's report(next) only shows what its callers already awaited (hold, resume, complete, cancel).
        if (/function report\(next\)/.test(scope)) continue;
        if (!/\bawait\b|\.then\(/.test(scope)) offenders.push(`${rel(file)}:${s.slice(0, m.index).split('\n').length}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('nothing that is only queued is described as delivered: the screens do not say an email "was sent" unless the server said so', () => {
    const reset = readFileSync(join(ROOT, 'src/app/accounts/page.js'), 'utf8');
    assert.match(reset, /notify\.success\(result\?\.message \|\| 'Password reset link sent\.'\)/, 'the sentence comes from the server\'s answer');
    const complaint = readFileSync(join(ROOT, 'src/components/complaints/ComplaintForm.js'), 'utf8');
    assert.match(complaint, /done\.email_sent === true/);
    assert.match(complaint, /done\.email_sent === false/);
  });
});

describe('the partner system is called SCMS (defect #13)', () => {
  it('the one constant and every sentence use SCMS; "(SMS)" is gone from the screens', () => {
    assert.equal(EXTERNAL_SYSTEMS.SMS.short, 'SCMS');
    assert.equal(EXTERNAL_SYSTEMS.SMS.label, 'Syllabus Management System (SCMS)');
    const left = [];
    for (const file of screens.concat(walk(join(ROOT, 'src/lib')).filter((f) => f.endsWith('.js')))) {
      const code = strip(readFileSync(file, 'utf8'));
      for (const m of code.matchAll(/\(SMS\)|'SMS'|"SMS"|>SMS</g)) left.push(`${rel(file)}: ${m[0]}`);
    }
    assert.deepEqual(left, []);
  });
});

describe('the glossary for the PM', () => {
  it('is in the repository as a draft that waits for decision D8-16', () => {
    const file = join(ROOT, '../../docs/ux-glossary-D8-16-draft.md');
    assert.ok(existsSync(file));
    const text = readFileSync(file, 'utf8');
    assert.match(text, /DRAFT/);
    assert.match(text, /D8-16/);
    for (const term of ['Start transaction', 'Put on hold', 'Resume', 'Complete', 'Print acknowledgement', 'Tracking number', 'Email queued', 'Email failed', 'Access pending', 'System temporarily unavailable']) assert.ok(text.includes(term), term);
  });
});
