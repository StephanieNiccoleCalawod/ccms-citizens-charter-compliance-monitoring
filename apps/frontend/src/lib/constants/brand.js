export const BRAND = {
  campus: 'PUP Quezon City',
  system: 'CCCMS',
  fullName: "Campus Citizen's Charter Management System",
};

// The other systems CCCMS connects to. Use the full name first; the short name only after it. "Audit" is only ever the Audit Logs of CCCMS.
export const EXTERNAL_SYSTEMS = {
  SMS: { short: 'SMS', fullName: 'Syllabus Management System', label: 'Syllabus Management System (SMS)' },
  FMS: { short: 'FMS', fullName: 'Faculty Management System', label: 'Faculty Management System (FMS)' },
};

/** The readable name of a system code the API sends (the Syllabus Management System is still sent as AUDIT by older records). */
export function externalSystemLabel(code) {
  const key = String(code ?? '').toUpperCase();
  if (key === 'AUDIT') return EXTERNAL_SYSTEMS.SMS.label;
  return EXTERNAL_SYSTEMS[key]?.label ?? String(code ?? '');
}
