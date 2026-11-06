import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isSelectable, recordOption, recordState, statusLabel } from '../../src/lib/ui/record-status.js';
import { filterOptions, firstEnabled, lastEnabled, stepEnabled } from '../../src/lib/ui/searchable-select.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('record status (is_active)', () => {
  it('only true is active, false is inactive, anything else is unknown and never selectable', () => {
    assert.equal(recordState({ is_active: true }), 'active');
    assert.equal(recordState({ is_active: false }), 'inactive');
    for (const bad of [{}, null, undefined, { is_active: null }, { is_active: 'true' }, { is_active: 1 }, { status: 'ACTIVE' }]) {
      assert.equal(recordState(bad), 'unknown');
      assert.equal(isSelectable(bad), false);
    }
    assert.equal(isSelectable({ is_active: true }), true);
    assert.equal(isSelectable({ is_active: false }), false);
  });
  it('adds (Inactive) once, never looks at the name to decide, and leaves an active label alone', () => {
    assert.equal(statusLabel('Campus Academic Office', { is_active: false }), 'Campus Academic Office (Inactive)');
    assert.equal(statusLabel('Campus Academic Office (inactive)', { is_active: false }), 'Campus Academic Office (inactive)');
    assert.equal(statusLabel('Campus Library', { is_active: true }), 'Campus Library');
    // a name that says "(Inactive)" on an active record is still active
    assert.equal(isSelectable({ office_name: 'Old (Inactive)', is_active: true }), true);
    assert.equal(statusLabel('X', {}), 'X (Status unknown)');
  });
  it('recordOption builds the dropdown option: disabled unless active', () => {
    assert.deepEqual(recordOption({ is_active: false }, 'o1', 'Office', { secondary: 's' }), { value: 'o1', label: 'Office (Inactive)', disabled: true, secondary: 's' });
    assert.deepEqual(recordOption({ is_active: true }, 'o2', 'Office'), { value: 'o2', label: 'Office', disabled: false });
  });
});

describe('searchable select keyboard stepping skips disabled options', () => {
  const list = [{ value: 'a', disabled: true }, { value: 'b' }, { value: 'c', disabled: true }, { value: 'd' }, { value: 'e', disabled: true }];
  it('finds the first and last chooseable option', () => {
    assert.equal(firstEnabled(list), 1);
    assert.equal(lastEnabled(list), 3);
    assert.equal(firstEnabled([{ disabled: true }]), -1);
    assert.equal(lastEnabled([]), -1);
  });
  it('steps down and up over disabled options, wrapping round', () => {
    assert.equal(stepEnabled(list, 1, 1), 3);
    assert.equal(stepEnabled(list, 3, 1), 1);
    assert.equal(stepEnabled(list, 1, -1), 3);
    assert.equal(stepEnabled(list, 3, -1), 1);
    assert.equal(stepEnabled([{ disabled: true }, { disabled: true }], 0, 1), 0, 'nothing to move to');
  });
  it('searching still finds inactive options (they stay visible)', () => {
    const options = [{ value: '1', label: 'Library (Inactive)', disabled: true }, { value: '2', label: 'Library North' }];
    assert.equal(filterOptions(options, 'lib').length, 2);
  });
});

describe('every dropdown of records uses the one rule (source checks, not a browser)', () => {
  const select = read('src/components/forms/SearchableSelect.js');
  it('SearchableSelect never selects a disabled option by mouse, Enter, or as the highlighted default', () => {
    assert.ok(select.includes('if (option?.disabled) return;'));
    assert.ok(select.includes('matches[active] && !matches[active].disabled'));
    assert.ok(select.includes('aria-disabled={option.disabled || undefined}'));
    assert.ok(select.includes('stepEnabled(matches, i,'));
    assert.ok(select.includes('setActive(firstEnabled(matches))') || select.includes('setActive(at >= 0 ? at : firstEnabled(matches))'));
    assert.ok(select.includes('cursor-not-allowed text-slate-400'));
  });
  it('RecordOption is a really disabled <option> in gray with aria-disabled', () => {
    const option = read('src/components/forms/RecordOption.js');
    assert.ok(option.includes('disabled={!selectable}') && option.includes("'text-slate-400'") && option.includes('aria-disabled'));
  });
  const native = {
    'src/app/accounts/page.js': 2,
    'src/app/calendar/Holidays.js': 1,
    'src/app/services/page.js': 1,
    'src/components/forms/ServiceForm.js': 1,
    'src/app/settings/Counters.js': 1,
    'src/app/transactions/page.js': 2,
    'src/components/transactions/StartTransactionForm.js': 1,
  };
  for (const [file, count] of Object.entries(native)) {
    it(`${file}: its record dropdowns use RecordOption and none hides or hand-labels an inactive record`, () => {
      const text = read(file);
      assert.ok([...text.matchAll(/<RecordOption /g)].length >= count);
      assert.ok(!/<option[^>]*>[^<]*is_active/.test(text), 'no hand-made (inactive) label inside an option');
      assert.ok(!/\.filter\(\(o\) => o\.is_active/.test(text), 'inactive offices are not filtered out of a dropdown');
    });
  }
  it('the Service pickers (Transactions filter, Add Transaction) list every service through recordOption', () => {
    assert.ok(read('src/app/transactions/page.js').includes('recordOption(s, s.service_id, s.service_name'));
    assert.ok(read('src/components/transactions/StartTransactionForm.js').includes('recordOption(service, service.service_id, service.service_name'));
    assert.ok(read('src/lib/api/transactions.js').includes('export async function listSelectableServices'));
  });
});
