import { createIdentityClient } from './identity-client.js';

/** Resolve display names per request. The stored name remains the outage fallback. */
export async function withCurrentAccountNames(rows, {
  identity = createIdentityClient(), idField = 'started_by', nameField = 'started_by_name',
} = {}) {
  const ids = [...new Set(rows.filter((row) => Object.hasOwn(row, nameField)).map((row) => row[idField]).filter(Boolean))];
  const names = new Map();
  for (let offset = 0; offset < ids.length; offset += 8) {
    await Promise.all(ids.slice(offset, offset + 8).map(async (id) => {
      try {
        const person = await identity.starterOf(id);
        if (typeof person?.name === 'string' && person.name.trim() && person.name.trim().length <= 200) names.set(id, person.name.trim());
      } catch {
        // A display lookup never changes access or prevents reading the existing record.
      }
    }));
  }
  return rows.map((row) => Object.hasOwn(row, nameField) && names.has(row[idField])
    ? { ...row, [nameField]: names.get(row[idField]) } : row);
}
