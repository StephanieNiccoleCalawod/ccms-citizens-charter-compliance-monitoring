export class S864TermAcademicYear1795679000000 {
  name = 'S864TermAcademicYear1795679000000';

  async up(runner) {
    // SMS supplies this value; existing terms stay null until SMS supplies it.
    await runner.query('ALTER TABLE term_dates ADD COLUMN academic_year text');
  }

  async down(runner) {
    await runner.query('ALTER TABLE term_dates DROP COLUMN academic_year');
  }
}
