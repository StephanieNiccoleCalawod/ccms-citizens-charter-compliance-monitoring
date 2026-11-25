import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, it } from 'node:test';
import { dismissResult, getResult, notify, resetNotifications } from '../../src/lib/ui/notify.js';

const read = (path) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

describe('S8-51 one result dialog', () => {
  beforeEach(() => resetNotifications());

  it('opens Success, Warning, Failed and Confirm with their own titles', () => {
    for (const [variant, title] of [['success', 'Success'], ['warning', 'Warning'], ['error', 'Failed'], ['confirm', 'Please confirm']]) {
      notify.result({ variant, message: 'Done.' });
      assert.equal(getResult().title, title);
      assert.equal(getResult().variant, variant);
    }
  });

  it('shows nothing for an empty message and treats an unknown kind as Failed', () => {
    assert.equal(notify.result({ variant: 'success', message: '  ' }), null);
    assert.equal(getResult(), null);
    notify.result({ variant: 'odd', message: 'x' });
    assert.equal(getResult().variant, 'error');
  });

  it('keeps an action only on Confirm, and a new result replaces the open one', () => {
    notify.result({ variant: 'success', message: 'Saved.', onConfirm: () => {} });
    assert.equal(getResult().onConfirm, null);
    notify.result({ variant: 'confirm', message: 'Delete?', onConfirm: () => {} });
    assert.equal(typeof getResult().onConfirm, 'function');
    assert.equal(getResult().confirmLabel, 'Confirm');
    dismissResult();
    assert.equal(getResult(), null);
  });

  it('is drawn once in the shell, as an alert dialog with focus on the safe button', () => {
    assert.match(read('components/layout/AppShell.js'), /<ResultModal \/>/);
    const modal = read('components/feedback/ResultModal.js');
    assert.match(modal, /role="alertdialog"/);
    assert.match(modal, /initialFocusRef=\{okRef\}/);
    assert.match(modal, /sr-only/);
  });
});
