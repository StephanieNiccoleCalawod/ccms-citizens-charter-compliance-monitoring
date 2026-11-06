// The ordered step editor for a service's procedure text (Decision C41), as pure functions.
//
// The API stores procedure steps as ONE plain-text field. The step editor is only an easier way to write
// it: it saves the same text, in the numbered format the Service Details parser already reads:
//
//   Step 1. First step
//   Step 2. Second step
//
// The editor is used only when the stored text survives a round trip with no change at all:
// serializeSteps(parseSimpleSteps(text)) === text. Anything else (sub-steps, locations, responsible
// persons, other numbering, other line endings, extra spaces) stays in the text box, exactly as stored.

export const PROCEDURE_LIMIT = 10000; // what Core accepts for processing_steps

const SIMPLE_LINE = /^Step (\d+)\. (\S(?:.*\S)?)$/;
// Parts the Service Details page shows separately (a location, an instruction, a responsible person).
// A step holding one is detailed text, not a plain step, so it stays in the text box.
const DETAIL_MARKER = /Location:|Notes\/Instruction:|\[Responsible:/i;

/** The step list as text: "Step 1. ...", one line per step, joined with a line feed. Each step is trimmed. */
export function serializeSteps(steps) {
  return steps.map((text, index) => `Step ${index + 1}. ${String(text).trim()}`).join('\n');
}

/**
 * The steps of a text written as plain numbered lines, or null when the text cannot be turned into a
 * list and back with every character kept. Null means: keep it in the text box.
 */
export function parseSimpleSteps(text) {
  if (typeof text !== 'string' || text === '') return null;
  const steps = [];
  for (const line of text.split('\n')) {
    const match = SIMPLE_LINE.exec(line);
    if (!match || Number(match[1]) !== steps.length + 1 || DETAIL_MARKER.test(match[2])) return null;
    steps.push(match[2]);
  }
  return serializeSteps(steps) === text ? steps : null;
}

/** Whether the step editor may be used for this stored text (nothing stored also qualifies: a new, empty list). */
export function canUseStepEditor(text) {
  return text === null || text === undefined || text === '' || parseSimpleSteps(text) !== null;
}

/** How a form opens: the step editor when the text round-trips exactly, otherwise the text box with the text untouched. */
export function initialProcedure(text) {
  if (text === null || text === undefined || text === '') return { mode: 'steps', steps: [], text: '' };
  const steps = parseSimpleSteps(text);
  return steps ? { mode: 'steps', steps, text } : { mode: 'text', steps: [], text };
}

export const addStep = (steps) => [...steps, ''];
export const removeStep = (steps, index) => steps.filter((_, i) => i !== index);
export const setStep = (steps, index, value) => steps.map((step, i) => (i === index ? value : step));

/** Moves a step one place up (-1) or down (+1). Returns the same list when it cannot move. */
export function moveStep(steps, index, direction) {
  const target = index + direction;
  if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Switching from the step editor to the text box: the current list as text. Blank, unsaved steps hold nothing and are left out. */
export function stepsToText(steps) {
  return serializeSteps(steps.filter((step) => String(step).trim() !== ''));
}

/** The text to send to the API for a form in either mode. In text mode this is the text exactly as it is in the box. */
export function procedureText(form) {
  return form.procedure_mode === 'steps' ? serializeSteps(form.procedure_steps) : form.processing_steps;
}

/** A message when the procedure cannot be saved (a blank step, or more than 10,000 characters); otherwise null. */
export function procedureProblem(form) {
  if (form.procedure_mode === 'steps') {
    const blank = form.procedure_steps.findIndex((step) => String(step).trim() === '');
    if (blank !== -1) return `Step ${blank + 1} is empty. Write it or remove it.`;
  }
  const length = procedureText(form).length;
  if (length > PROCEDURE_LIMIT) return `The procedure steps are ${length.toLocaleString('en-US')} characters. The limit is ${PROCEDURE_LIMIT.toLocaleString('en-US')}.`;
  return null;
}

/** The procedure fields of a form for a stored text: the text itself plus the step editor's view of it. */
export function procedureFields(text) {
  const { mode, steps } = initialProcedure(text);
  return { processing_steps: text ?? '', procedure_mode: mode, procedure_steps: steps };
}

/** What goes in the request's processing_steps: the step editor's numbered text, or the text box exactly as it is; empty is null. */
export function procedureForBody(form) {
  const text = procedureText(form);
  return text.trim() === '' ? null : text;
}

/** Edit as text: the fields for the text box, filled with the current steps in the numbered format. */
export function toTextMode(form) {
  return { procedure_mode: 'text', processing_steps: stepsToText(form.procedure_steps) };
}

/** Use step editor: the fields for the editor, or null when the text cannot be kept exactly as a list (it then stays as text). */
export function toStepMode(form) {
  if (!canUseStepEditor(form.processing_steps)) return null;
  return { procedure_mode: 'steps', procedure_steps: parseSimpleSteps(form.processing_steps) ?? [] };
}
