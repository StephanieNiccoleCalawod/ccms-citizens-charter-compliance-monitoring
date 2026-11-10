import { readFileSync } from 'node:fs';
import { assertNewTablesCompatible, assertTablesEmptyBeforeDrop } from 'ccms-shared';
const expected = Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL('./integration-schema.json', import.meta.url), 'utf8')))
  .filter(([key]) => key === 'table:forecast_runs' || /^(column|constraint|index|trigger|grant):forecast_runs\./.test(key)));
export class Cc038ForecastRuns1794300300000 {
  name = 'Cc038ForecastRuns1794300300000';
  async up(runner) {
    if (await assertNewTablesCompatible(runner, expected)) return;
    await runner.query(readFileSync(new URL('./sql/1794300300000-Cc038ForecastRuns.up.sql', import.meta.url), 'utf8'));
  }
  async down(runner) {
    await assertTablesEmptyBeforeDrop(runner, this.name, ['forecast_runs']);
    await runner.query('DROP TABLE IF EXISTS forecast_runs');
  }
}
