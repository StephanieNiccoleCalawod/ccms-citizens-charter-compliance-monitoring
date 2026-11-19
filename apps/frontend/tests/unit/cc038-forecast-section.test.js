// CC038 source-level checks for RequestForecastSection and RequestForecastChart.
// These tests verify structure, RBAC guards, and design-token compliance without a browser.
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { retrainRequestForecast } from '../../src/lib/api/request-forecast.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(`${ROOT}${rel}`, 'utf8');

const section = read('src/components/dashboard/RequestForecastSection.js');
const chart   = read('src/components/dashboard/RequestForecastChart.js');
const apiLib  = read('src/lib/api/request-forecast.js');
const dashboard = read('src/components/dashboard/DashboardAnalytics.js');

describe('CC038 RequestForecastSection', () => {
  it('imports and renders inside DashboardAnalytics (and /insights route is removed)', () => {
    assert.match(dashboard, /import RequestForecastSection from '\.\/RequestForecastSection\.js'/);
    assert.match(dashboard, /<RequestForecastSection[\s\S]*user=\{user\}/);
    assert.equal(existsSync(`${ROOT}src/components/insights/InsightsPage.js`), false);
    assert.equal(existsSync(`${ROOT}src/app/insights/page.js`), false);
  });

  it('uses TableShell for the forecast table (no raw <table>/<thead>/<th> tags)', () => {
    assert.doesNotMatch(section, /<table[\s>]|<thead[\s>]|<th[\s>]/);
    assert.match(section, /import TableShell, \{ Table, Th \} from '\.\.\/ui\/TableShell\.js'/);
    assert.match(section, /<TableShell[\s>]/);
  });

  it('wraps setState calls in Promise.resolve() to satisfy react-hooks/set-state-in-effect', () => {
    assert.match(section, /Promise\.resolve\(\)\.then\(\(\) => setOfficeId/);
    assert.match(section, /Promise\.resolve\(\)\.then\(\(\) => fetchForecast/);
  });

  it('shows the retrain button only for SUPER_ADMIN', () => {
    assert.match(section, /isSuperAdmin.*Retrain|Retrain.*isSuperAdmin/s);
    assert.match(section, /isSuperAdmin\s+=\s+user\.role === ROLES\.SUPER_ADMIN/);
  });

  it('shows the office selector only for non-office-bound roles', () => {
    assert.match(section, /!isOfficeBound.*offices\.length > 1/);
  });

  it('renders data-testid markers for each forecast state', () => {
    assert.match(section, /data-testid="forecast-not-enough-history"/);
    assert.match(section, /data-testid="forecast-too-few"/);
    assert.match(section, /data-testid="forecast-success"/);
    assert.match(section, /data-testid="forecast-empty"/);
  });

  it('uses the API adapter and shared submission, feedback and confirmation controls', () => {
    assert.match(section, /import.*getRequestForecast.*from/);
    assert.match(apiLib, /import.*apiFetch.*from/);
    assert.match(section, /import.*useSingleSubmit.*from/);
    assert.match(section, /import.*notify.*from/);
    assert.match(section, /import ConfirmDialog from/);
  });

  it('loads selector data through the forecast adapter using the shared catalogue endpoints', () => {
    assert.match(apiLib, /import \{ OFFICES_API, SERVICES_API \} from/);
    assert.match(section, /Promise\.all\(\[getForecastOffices\(\), getForecastServices\(\)\]\)/);
    assert.match(apiLib, /return fetcher\(OFFICES_API\)/);
    assert.match(apiLib, /return fetcher\(SERVICES_API\)/);
  });
});

describe('CC038 RequestForecastChart', () => {
  it('uses ComposedChart with Area and Line from recharts', () => {
    assert.match(chart, /ComposedChart/);
    assert.match(chart, /Area/);
    assert.match(chart, /Line/);
  });

  it('does not import ReferenceArea (unused)', () => {
    assert.doesNotMatch(chart, /ReferenceArea/);
  });

  it('marks the section heading with aria-label for accessibility', () => {
    assert.match(chart, /aria-label="Request volume forecast chart/);
  });

  it('uses the CCCMS maroon color for the actual line', () => {
    assert.match(chart, /#800000/);
  });

  it('forecast line uses a dashed stroke', () => {
    assert.match(chart, /strokeDasharray/);
  });
});

describe('CC038 request-forecast API module', () => {
  it('exports getRequestForecast and retrainRequestForecast', () => {
    assert.match(apiLib, /export function getRequestForecast/);
    assert.match(apiLib, /export function retrainRequestForecast/);
  });

  it('GET uses the correct base path', () => {
    assert.match(apiLib, /FORECAST_BASE = '\/api\/operations\/analytics\/forecast'/);
  });

  it('retrain uses POST method and passes an unstringified object body for apiFetch', async () => {
    assert.match(apiLib, /method: 'POST'/);
    let captured;
    await retrainRequestForecast({ officeId: 'o1', serviceId: 's1' }, async (url, opts) => {
      captured = { url, opts };
      return { status: 'SUCCESS' };
    });
    assert.equal(captured.url, '/api/operations/analytics/forecast/retrain');
    assert.equal(captured.opts.method, 'POST');
    assert.deepEqual(captured.opts.body, { officeId: 'o1', serviceId: 's1' });
  });
});

describe('CC038 controlled Insights integration and stale warning', () => {
  it('calls useSingleSubmit() as a function for handleRetrain', () => {
    assert.match(section, /const once = useSingleSubmit\(\)/);
    assert.match(section, /await once\(async \(\) =>/);
  });

  it('accepts externalRun and skips duplicate office-level GET when controlled', () => {
    assert.match(section, /externalRun/);
    assert.match(section, /refreshRevision/);
    assert.match(section, /usingExternal = controlledOfficeId !== undefined && hasExternalRun && !serviceId/);
    assert.match(section, /controlledOfficeId !== undefined && hasExternalRun && !sId/);
  });

  it('displays an explicit warning banner when an earlier fallback forecast is marked stale', () => {
    assert.match(section, /activeRun\.stale/);
    assert.match(section, /Showing an earlier forecast/);
  });
});
