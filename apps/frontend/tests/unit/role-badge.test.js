import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLE_LIST, ROLES } from 'ccms-shared/roles';
import { ROLE_BADGE_CLASSES, roleBadgeClasses } from '../../src/lib/ui/role-style.js';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('role badge colours', () => {
  it('every role has a colour, and no two roles share one', () => {
    for (const role of ROLE_LIST) assert.ok(ROLE_BADGE_CLASSES[role], role);
    const colours = ROLE_LIST.map((role) => roleBadgeClasses(role));
    assert.equal(new Set(colours).size, ROLE_LIST.length);
  });
  it('uses the soft background and darker text of each role', () => {
    assert.equal(roleBadgeClasses(ROLES.SUPER_ADMIN), 'bg-[#FEE2E2] text-[#991B1B]');
    assert.equal(roleBadgeClasses(ROLES.OFFICE_HEAD), 'bg-[#DBEAFE] text-[#1D4ED8]');
    assert.equal(roleBadgeClasses(ROLES.OFFICE_STAFF), 'bg-[#D1FAE5] text-[#047857]');
    assert.equal(roleBadgeClasses(ROLES.EXECUTIVE), 'bg-[#F3E8FF] text-[#7E22CE]');
  });
  it('no role badge is solid or dark: no white text, no 600-900 shades, no opacity on the badge', () => {
    for (const role of ROLE_LIST) assert.doesNotMatch(roleBadgeClasses(role), /text-white|bg-w+-[6-9]00|opacity/);
    assert.doesNotMatch(read('src/components/ui/RoleBadge.js'), /opacity/);
  });
  it('the same role always gives the same colour, and an unknown role gets a neutral grey', () => {
    assert.equal(roleBadgeClasses(ROLES.OFFICE_HEAD), roleBadgeClasses(ROLES.OFFICE_HEAD));
    assert.equal(roleBadgeClasses('something_else'), 'bg-slate-100 text-slate-700');
  });
});

describe('where the role badge is used', () => {
  it('the Accounts table and the audit log use the one RoleBadge component, not their own styles', () => {
    assert.ok(read('src/app/accounts/page.js').includes('<RoleBadge role={account.role} />'));
    assert.ok(read('src/app/logs/page.js').includes('<RoleBadge role={event.actor_role} />'));
    assert.ok(!read('src/app/accounts/page.js').includes('variant="role"'));
  });
  it('status badges are untouched: Active and Inactive keep their classes in StatusBadge', () => {
    const status = read('src/components/ui/StatusBadge.js');
    assert.ok(status.includes("active: 'bg-emerald-50 text-emerald-700'"));
    assert.ok(status.includes("inactive: 'bg-slate-100 text-slate-600'"));
    assert.ok(read('src/app/accounts/page.js').includes("<StatusBadge variant={account.is_active ? 'active' : 'inactive'}>"));
  });
  it('the role values and labels are not changed here (they come from ccms-shared)', () => {
    assert.ok(!read('src/lib/ui/role-style.js').includes('ROLE_LABELS ='));
  });
});

describe('the Accounts filter row (source checks, not a browser)', () => {
  const page = read('src/app/accounts/page.js');
  it('has even padding and gaps, wraps on tablet and stacks on mobile', () => {
    assert.ok(page.includes('<div className="card p-5 sm:p-6">'));
    assert.ok(page.includes('flex flex-wrap items-end gap-x-5 gap-y-4'));
    // every filter group is full width on a phone and a fixed width from the sm breakpoint up
    for (const id of ['account-search', 'filter-role', 'filter-office', 'filter-status']) {
      const at = page.indexOf(`htmlFor="${id}"`);
      const group = page.slice(page.lastIndexOf('<div className=', at), at);
      assert.ok(/w-full sm:w-\d+/.test(group), id);
    }
  });
  it('the three dropdowns share one arrow style, and search and Add Account keep their places', () => {
    assert.equal([...page.matchAll(/className="input select-chevron"/g)].length, 3);
    assert.ok(page.includes('sm:ml-auto sm:w-auto'));
    assert.ok(page.includes('id="account-search"') && page.includes('+ Add Account'));
  });
});

describe('the Offices status filter (source checks, not a browser)', () => {
  const page = read('src/app/offices/page.js');
  it('has a Status dropdown (All, Active, Inactive) beside the search, with the same spacing and arrow as the Accounts filters', () => {
    assert.ok(page.includes('htmlFor="office-status"'));
    assert.ok(page.includes('id="office-status" className="input select-chevron"'));
    for (const value of ['value=""', 'value="active"', 'value="inactive"']) assert.ok(page.includes(value), value);
    assert.ok(page.includes('<div className="card p-5 sm:p-6">'));
    assert.ok(page.includes('flex flex-wrap items-end gap-x-5 gap-y-4'));
  });
  it('filters the list already loaded, together with the search, and sends no new request', () => {
    assert.ok(page.includes("(status === '' || (status === 'active') === o.is_active)"));
    assert.ok(page.includes('}, [state.items, search, status]);'));
  });
  it('Search office and + Add Office keep their places', () => {
    assert.ok(page.includes('id="office-search"') && page.includes('+ Add Office') && page.includes('sm:ml-auto'));
  });
});

describe('the Services filter row (source checks, not a browser)', () => {
  const page = read('src/app/services/page.js');
  it('is the filter form of the /services page itself, with the same panel padding as the other filter panels', () => {
    assert.ok(page.includes('function ServicesManager'));
    assert.ok(page.includes('p-5 sm:p-6'));
    assert.ok(page.includes('flex flex-wrap items-end gap-x-4 gap-y-4'));
  });
  it('Office, Classification and Status share the select arrow and have fixed widths from the sm size, full width on a phone', () => {
    assert.equal([...page.matchAll(/className="input select-chevron"/g)].length, 3);
    for (const id of ['svc-office', 'svc-class', 'svc-status']) {
      const at = page.indexOf(`htmlFor="${id}"`);
      const group = page.slice(page.lastIndexOf('<div className=', at), at);
      assert.ok(/w-full sm:w-\d+/.test(group), id);
    }
  });
  it('search, the Search button and Add Service (which still opens the form) keep working and stay at the right', () => {
    assert.ok(page.includes('id="svc-search"') && page.includes('applyFilters(filters)'));
    assert.ok(page.includes('btn-primary w-full sm:ml-auto sm:w-auto" onClick={() => openForm(null)}'));
  });
});

describe('no Apply or Search button on the admin filter panels (source checks, not a browser)', () => {
  it('Services: the dropdowns apply when changed and the search on Enter or when the field is left, with no Search button', () => {
    const page = read('src/app/services/page.js');
    assert.ok(page.includes('onBlur={() => filters.search.trim() !== applied.search.trim() && applyFilters(filters)}'));
    assert.ok(!/>\s*Search\s*<\/button>/.test(page));
    assert.ok(page.includes('applyFilters({ ...filters, office_id: e.target.value })'));
  });
  it('Logs: no Apply button, and the same padding as the other filter panels', () => {
    const page = read('src/app/logs/page.js');
    assert.ok(!page.includes('Apply filters'));
    assert.ok(page.includes('<form className="card p-5 sm:p-6"'));
  });
  it('Transactions, Accounts and Offices have none either', () => {
    for (const file of ['src/app/transactions/page.js', 'src/app/accounts/page.js', 'src/app/offices/page.js']) assert.ok(!read(file).includes('Apply filters'), file);
  });
});
