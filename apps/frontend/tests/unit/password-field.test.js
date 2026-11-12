import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PASSWORD_MAX, PASSWORD_MIN, PASSWORD_RECOMMENDED, PASSWORD_REQUIREMENTS, passwordStatus } from '../../src/lib/ui/password-guidance.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('password guidance', () => {
  it('only the limits Identity enforces block (8 to 200 characters); no character-mix rule', () => {
    assert.equal([PASSWORD_MIN, PASSWORD_RECOMMENDED, PASSWORD_MAX].join(), '8,16,200');
    assert.deepEqual(passwordStatus(''), { level: 'empty', message: '', blocking: false });
    const short = passwordStatus('abc1234');
    assert.equal(short.blocking, true);
    assert.match(short.message, /at least 8 characters \(7 so far\)/);
    assert.equal(passwordStatus('a'.repeat(201)).blocking, true);
    // all lower case letters, no digit or symbol: still accepted
    assert.equal(passwordStatus('abcdefgh').blocking, false);
    assert.equal(passwordStatus('a'.repeat(200)).blocking, false);
  });
  it('8 to 15 characters is accepted with a recommendation; 16 or more is good', () => {
    const ok = passwordStatus('correcthorse');
    assert.equal(ok.level, 'ok');
    assert.equal(ok.blocking, false);
    assert.match(ok.message, /16 or more characters is recommended/);
    assert.equal(passwordStatus('correct horse battery staple').level, 'good');
    assert.equal(passwordStatus('a'.repeat(16)).level, 'good');
  });
  it('lists the guidance: 16+, a 4–7 word passphrase, all character kinds allowed and none required', () => {
    const text = PASSWORD_REQUIREMENTS.join(' ');
    assert.match(text, /16 characters/);
    assert.match(text, /4–7 unrelated words/);
    assert.match(text, /none is required/);
  });
});

describe('the password field (source checks, not a browser)', () => {
  const field = read('src/components/forms/PasswordField.js');
  const page = read('src/app/accounts/page.js');
  it('the eye button is a real button that only switches the input type, with a label that changes', () => {
    assert.ok(field.includes('type={visible ? \'text\' : \'password\'}'));
    assert.match(field, /<button\r?\n {10}type="button"/);
    assert.ok(field.includes("aria-label={visible ? 'Hide password' : 'Show password'}"));
    assert.ok(field.includes('aria-pressed={visible}') && field.includes('aria-controls={id}'));
    assert.ok(field.includes('<EyeIcon off={visible} />'));
    // the value is never touched by the toggle
    assert.ok(!/setVisible\([^)]*onChange/.test(field));
    assert.ok(field.includes('value={value}') && field.includes('onChange(e.target.value)'));
  });
  it('the requirements and the live message are tied to the input for screen readers', () => {
    assert.ok(field.includes('aria-describedby={`${hintId} ${statusId}`}'));
    assert.ok(field.includes('aria-invalid={invalid || undefined}'));
    assert.ok(field.includes('PASSWORD_REQUIREMENTS.map'));
  });
  it('the Accounts form uses it for a new account and keeps the same payload', () => {
    assert.ok(page.includes('<PasswordField'));
    assert.ok(page.includes('body: { ...body, password: form.password }'), 'the create payload is unchanged');
    assert.ok(!page.includes('type="password"'));
    assert.ok(page.includes('passwordStatus(form.password)') && page.includes('password.blocking'));
    assert.ok(page.includes('error={fieldErrors.password ?? null}'), 'a server message for the field is still shown');
  });
});
