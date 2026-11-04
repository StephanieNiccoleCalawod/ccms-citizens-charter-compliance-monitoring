// Runs after TypeORM has created the tables. Everything here is idempotent.
export async function afterSync(dataSource) {
  // One account per email, regardless of letter case (TypeORM cannot declare an expression index).
  await dataSource.query('CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_lower_uq ON accounts (lower(email))');
}
