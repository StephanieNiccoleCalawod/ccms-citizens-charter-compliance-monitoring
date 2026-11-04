// npm run bootstrap:admin
// Creates the first Super Admin from environment variables when no Super Admin exists.
//   BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD  (required)
//   BOOTSTRAP_ADMIN_EMPLOYEE_NO (default ADMIN-001), BOOTSTRAP_ADMIN_NAME (default System Administrator)
import { getDataSource } from 'ccms-shared';
import { bootstrapSuperAdmin } from '../src/lib/bootstrap.js';
import { dbOptions } from '../src/lib/data-source.js';

const dataSource = await getDataSource({ ...dbOptions, synchronize: true });
try {
  const result = await bootstrapSuperAdmin(dataSource, {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    employeeNo: process.env.BOOTSTRAP_ADMIN_EMPLOYEE_NO || undefined,
    fullName: process.env.BOOTSTRAP_ADMIN_NAME || undefined,
  });
  console.log(result.created ? 'Created the first Super Admin.' : 'A Super Admin already exists. Nothing changed.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await dataSource.destroy();
}
