import { assertTablesEmptyBeforeDrop } from 'ccms-shared';

export class Cc043Registry1794441600000 {
  name = 'Cc043Registry1794441600000';

  async up(runner) {
    await runner.query(`
      CREATE TABLE registry_imports (
        import_id uuid PRIMARY KEY,
        rows integer NOT NULL,
        added integer NOT NULL,
        updated integer NOT NULL,
        unchanged integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT registry_imports_counts_check
          CHECK (rows > 0 AND added >= 0 AND updated >= 0 AND unchanged >= 0 AND rows = added + updated + unchanged)
      );
      CREATE TABLE registry_people (
        student_number varchar(30) PRIMARY KEY,
        full_name varchar(200) NOT NULL,
        program varchar(20) NOT NULL,
        year_level smallint,
        status varchar(8) NOT NULL,
        valid_until date,
        email varchar(254),
        last_import_id uuid NOT NULL REFERENCES registry_imports(import_id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT registry_people_program_check CHECK (program ~ '^[A-Z0-9-]{2,20}$'),
        CONSTRAINT registry_people_status_check CHECK (
          (status = 'ENROLLED' AND valid_until IS NOT NULL AND year_level IS NOT NULL AND year_level BETWEEN 1 AND 6)
          OR (status = 'ALUMNI' AND year_level IS NULL)
        )
      );
    `);
  }

  async down(runner) {
    await assertTablesEmptyBeforeDrop(runner, this.name, ['registry_people', 'registry_imports']);
    await runner.query('DROP TABLE registry_people; DROP TABLE registry_imports;');
  }
}
