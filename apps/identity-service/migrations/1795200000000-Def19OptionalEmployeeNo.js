// QA DEF-19 / Decision F6 (10/16/2026): the employee number is optional ("if any"), and still unique when given.
// accounts.employee_no loses NOT NULL; the unique constraint stays (PostgreSQL allows many NULLs under UNIQUE).
export class Def19OptionalEmployeeNo1795200000000 {
  name = 'Def19OptionalEmployeeNo1795200000000';

  async up(runner) {
    await runner.query('ALTER TABLE accounts ALTER COLUMN employee_no DROP NOT NULL');
  }

  async down(runner) {
    const [{ count }] = await runner.query('SELECT count(*)::int AS count FROM accounts WHERE employee_no IS NULL');
    if (count) throw new Error(`${count} accounts have no employee number; give them one before reverting (no records were changed)`);
    await runner.query('ALTER TABLE accounts ALTER COLUMN employee_no SET NOT NULL');
  }
}
