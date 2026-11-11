import { assertColumnsEmptyBeforeDrop } from 'ccms-shared';

export class Cc058CalendarReasons1794441700000 {
  name = 'Cc058CalendarReasons1794441700000';

  async up(runner) {
    await runner.query(`
      ALTER TABLE calendar_exceptions
        ADD COLUMN reason_category varchar(30) NOT NULL DEFAULT 'OTHER',
        ADD COLUMN reference varchar(100),
        ADD CONSTRAINT calendar_exceptions_reason_category_check CHECK (reason_category IN (
          'TYPHOON_WEATHER', 'HEAT_INDEX', 'POWER_WATER_OUTAGE', 'EARTHQUAKE_DRILL',
          'SECURITY_THREAT', 'HOLIDAY_PROCLAMATION', 'UNIVERSITY_EVENT', 'OTHER'
        ));
    `);
  }

  async down(runner) {
    await assertColumnsEmptyBeforeDrop(runner, this.name, 'calendar_exceptions', ['reason_category', 'reference']);
    await runner.query(`ALTER TABLE calendar_exceptions
      DROP CONSTRAINT calendar_exceptions_reason_category_check,
      DROP COLUMN reference, DROP COLUMN reason_category`);
  }
}
