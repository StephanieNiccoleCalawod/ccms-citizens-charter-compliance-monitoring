// npm run analytics:backfill -- [--max-pages=N] [--page-size=N] [--reset] [--confirm=<database>]
//
// TT2: pulls every transaction from Operations (OPERATIONS_SERVICE_URL, SERVICE_KEY) and upserts it into
// analytics_transactions through the same validation and conditional upsert as the live feed. Without --max-pages it
// runs until the current pass is complete; it resumes a pass a crashed or bounded run left behind. --reset starts a new
// pass from the first page. Running it again is safe (same row count and content). It never seeds data, sends email,
// writes audit entries or changes anything in Operations.
//
// Connection: DATABASE_URL, the runtime role (ccms_logs_writer). A hosted database needs DB_TARGET=hosted and
// --confirm=<database name>. Only the host and database name are printed; never credentials or records.
import { createDataSource, describeDatabaseUrl, resolveDbTarget } from 'ccms-shared';
import { entities } from '../src/lib/entities/index.js';
import { runAnalyticsBackfill } from '../src/modules/analytics/backfill.js';

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unknown argument ${arg}`);
    flags[match[1]] = match[2] ?? true;
  }
  for (const key of Object.keys(flags)) {
    if (!['max-pages', 'page-size', 'reset', 'confirm'].includes(key)) throw new Error(`Unknown option --${key}`);
  }
  const whole = (name) => {
    if (flags[name] === undefined) return undefined;
    if (!/^\d+$/.test(String(flags[name])) || Number(flags[name]) < 1) throw new Error(`--${name} must be a whole number of at least 1`);
    return Number(flags[name]);
  };
  return { maxPages: whole('max-pages'), pageSize: whole('page-size'), reset: flags.reset === true, confirm: flags.confirm };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  const where = describeDatabaseUrl(url);
  const { target, declared, reason } = resolveDbTarget(url);
  console.log(`oversight: analytics backfill into "${where.database}" at ${where.host}:${where.port} (target ${target}: ${reason})`);
  if (target === 'hosted') {
    if (declared !== 'hosted') throw new Error('Set DB_TARGET=hosted explicitly to backfill a hosted database.');
    if (options.confirm !== where.database) throw new Error(`Refusing to backfill a hosted database without --confirm=${where.database}.`);
  }
  const dataSource = createDataSource({ url, entities, synchronize: false });
  await dataSource.initialize();
  try {
    const summary = await runAnalyticsBackfill({
      dataSource,
      operationsUrl: process.env.OPERATIONS_SERVICE_URL,
      serviceKey: process.env.SERVICE_KEY,
      maxPages: options.maxPages ?? Number.POSITIVE_INFINITY,
      timeBudgetMs: Number.POSITIVE_INFINITY,
      ...(options.pageSize ? { pageSize: options.pageSize } : {}),
      reset: options.reset,
    });
    console.log(JSON.stringify(summary));
    return summary.ok ? 0 : 1;
  } finally {
    await dataSource.destroy();
  }
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
