// Read-only helpers that turn the free-text catalogue fields into structure for the Service Details page.
// The API stores procedure steps and document notes as plain text; nothing here invents data. When the
// text does not follow the expected shape, each function returns null so the page can show it as-is.

const STEP_LINE = /^Step\s+(\d+)\s*[.:)]\s*(.+)$/i;
const SUBSTEP_LINE = /^\s+(\d+(?:\.\d+)*)\.?\s+(.+)$/;
const RESPONSIBLE = /^(.*?)\s*\[Responsible:\s*([^\]]*)\]\s*$/i;
const TRAILING_ASIDE = /^(.*\S)\s+(\([^()]*\))$/;

function parseStepHead(rest) {
  const locationAt = rest.search(/\sLocation:\s*/i);
  const head = locationAt === -1 ? rest : rest.slice(0, locationAt);
  let location = null;
  let instruction = null;
  if (locationAt !== -1) {
    const after = rest.slice(locationAt).replace(/^\s*Location:\s*/i, '');
    const noteAt = after.search(/\s?Notes\/Instruction:\s*/i);
    location = (noteAt === -1 ? after : after.slice(0, noteAt)).trim() || null;
    if (noteAt !== -1) instruction = after.slice(noteAt).replace(/^\s*Notes\/Instruction:\s*/i, '').trim() || null;
  }
  const aside = TRAILING_ASIDE.exec(head.trim());
  return {
    title: (aside ? aside[1] : head).trim(),
    aside: aside ? aside[2] : null,
    location,
    instruction,
  };
}

function parseSubstep(label, body) {
  const match = RESPONSIBLE.exec(body);
  return {
    label,
    text: (match ? match[1] : body).trim(),
    roles: match ? match[2].split(';').map((r) => r.trim()).filter(Boolean) : [],
  };
}

/** Returns [{ number, title, aside, location, instruction, substeps: [{ label, text, roles }] }] or null. */
export function parseProcedureSteps(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const steps = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const stepMatch = STEP_LINE.exec(line);
    if (stepMatch) {
      steps.push({ number: Number(stepMatch[1]), ...parseStepHead(stepMatch[2]), substeps: [] });
      continue;
    }
    const subMatch = SUBSTEP_LINE.exec(line);
    if (!subMatch || steps.length === 0) return null;
    steps[steps.length - 1].substeps.push(parseSubstep(subMatch[1], subMatch[2]));
  }
  return steps.length > 0 ? steps : null;
}

const NOTE_LABELS = [
  { key: 'copies', pattern: /Copies\s*:/i },
  { key: 'where', pattern: /Where to secure\s*:/i },
  { key: 'remarks', pattern: /Remarks?\s*:/i },
];

/**
 * Splits a document's notes into { copies, where, remarks } when they use the "Where to secure:" /
 * "Remarks:" labels. Text before the first label is the copy requirement. Returns null otherwise.
 */
export function parseDocumentNotes(notes) {
  if (typeof notes !== 'string' || notes.trim() === '') return null;
  const found = NOTE_LABELS.map((label) => {
    const match = label.pattern.exec(notes);
    return match ? { key: label.key, start: match.index, end: match.index + match[0].length } : null;
  })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  if (!found.some((f) => f.key === 'where' || f.key === 'remarks')) return null;

  const clean = (value) => value.trim().replace(/[.\s]+$/, '') || null;
  const result = { copies: null, where: null, remarks: null };
  const lead = notes.slice(0, found[0].start);
  if (lead.trim() !== '') result.copies = clean(lead);
  found.forEach((f, i) => {
    const value = notes.slice(f.end, i + 1 < found.length ? found[i + 1].start : notes.length);
    result[f.key] = f.key === 'remarks' ? value.trim() || null : clean(value);
  });
  return result;
}

/** Splits text into [{ text } | { href }] so http(s) addresses can be shown as links (nothing else becomes a link). */
export function splitLinks(text) {
  if (typeof text !== 'string' || text === '') return [];
  return text
    .split(/(https?:\/\/[^\s<>"')]+)/i)
    .filter((part) => part !== '')
    .map((part) => (/^https?:\/\//i.test(part) ? { href: part.replace(/[.,;]+$/, '') } : { text: part }));
}
