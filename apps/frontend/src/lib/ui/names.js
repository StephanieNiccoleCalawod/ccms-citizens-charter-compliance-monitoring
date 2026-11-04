// People read names, not codes. These helpers pick the name the API provided and fall back to the code only when the API
// has no name for that record (for example an old transaction whose office was later removed). Nothing is made up.

/** The office's name; its code only when the API sent no name. */
export const officeName = (record) => {
  const name = record?.office_name;
  if (typeof name === 'string' && name.trim()) return name;
  return record?.office_code ?? '';
};
