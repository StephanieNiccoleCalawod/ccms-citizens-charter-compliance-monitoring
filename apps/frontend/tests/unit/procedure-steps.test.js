import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { parseProcedureSteps } from '../../src/lib/ui/parseProcedure.js';
import {
  PROCEDURE_LIMIT,
  addStep,
  canUseStepEditor,
  initialProcedure,
  moveStep,
  parseSimpleSteps,
  procedureFields,
  procedureForBody,
  procedureProblem,
  removeStep,
  serializeSteps,
  setStep,
  toStepMode,
  toTextMode,
} from '../../src/lib/ui/procedure-steps.js';

// Real procedure texts copied from the seeded catalogue (ccms_core.services.processing_steps), byte for byte.
const SEEDED = {
  crlfWithSubsteps: "Step 1. Present letter of request to the Office of Student Affairs and Services. The letter should be addressed to the Head of Student Affairs and Services duly noted by the organization Adviser Location: Campus Student Services and Affairs Office\r\n  1. Receive and check the letter [Responsible: Staff/ Head of Student Affairs and Services; Campus Student Services and Affairs Office]",
  lfWithSubsteps: "Step 2. Without referral Location: Medical Clinic, PUP Campus\n  2. Provide discharge instructions that includes home medications, advise and follow-up. [Responsible: Physician/Nurse]\nStep 3. Proceed to the receiving area. Location: Medical Clinic, PUP Campus\n  3. Dispense the initial dose of medicine if available with instruction. [Responsible: Physician/Nurse]\nStep 4. Fill out and sign in the Daily Treatment Record (DTR) Location: Medical Clinic, PUP Campus\n  4. Assist patient in filling out the Daily Treatment Record. [Responsible: Physician/Nurse]\n  1.1. Inquire of the patient's chief complaint or illness [Responsible: Physician/Nurse]\n  1.2. Take patient's vital signs (Blood Pressure, Temperature, Respiratory Rate, Pulse Rate). [Responsible: Physician/Nurse]\n  1.3. Assess and evaluate the condition of the patient by taking the medical history and performing physical examination. [Responsible: Physician/Nurse]\n  1.4. Provide immediate treatment / intervention. [Responsible: Physician/Nurse]",
  withInstruction: "Step 1. Present PUP ID's and/or Registration Card at the Student Services Section and Sign on the 'Received' column on the logbook Location: Section Staff, Accounting Department Campus and Main Campus Notes/Instruction: Processing Time for 1.1. 3 minutes (depends upon the internet connectivity)\r\n  1.1. Check in the SIS If the student is entitled for off-setting [Responsible: Section Staff, Accounting Department]\r\n  1.2. Make proper and valid adjustments in the students account in the SIS. if the Student is entitled for offsetting, the CDO will request for the offsetting of the student thru the email of accounting student services section with the student details or information [Responsible: Section Staff, Accounting Department; Any of requesting office / division]\r\n  1.3. Inform student that it's finished. And advise the students to check their SIS account for the updates [Responsible: Section Staff, Accounting Department; Any of requesting office / division]",
  withAside: "Step 1. Go to the Faculty member(s) assigned to the subject(s) to be enrolled for acceptance to the class Location: Assigned Room(s) based on Teaching Assignment\r\n  1. Accept and sign the R0 form [Responsible: Faculty Member/s Assigned Room/s based on Teaching Assignment]\r\nStep 2. Go to the Director/Head of Academic Program for signature and tagging Location: Director/Head of Academic Program Offices\r\n  2.1. Accept, evaluate, and sign the R0 form. [Responsible: Director/Head of Academic Program]\r\n  2.2. Tag the subject(s) indicated in the R0 Form. [Responsible: Director/Head of Academic Program]\r\nStep 3. Proceed to Cashier's Office to pay the assessed fee (for students not covered by R.A. 10931) Location: Cashier's Office / Accounting Office\r\n  3. Accept payment and issue official receipt [Responsible: Collecting and Disbursement Officer / Cashier]",
};

// The first sample of the parser tests (also a real seeded text).
const ENR_001 =
  "Step 1. Go to the Director/Head of Academic Program for signature and tagging of subject Location: Director/Head of Academic Program Offices\r\n  1.1. Accept, evaluate, and sign the ACE form (Adding of Subjects). [Responsible: Director/Head of Academic Program]\r\n  1.2. Tag the subject(s). [Responsible: Director/Head of Academic Program]\r\nStep 2. Proceed to Cashier's Office to pay the assessed fee (for students not covered by R.A. 10931) Location: CDO Cashier/Accounting Office\r\n  2. Accept payment and issue official receipt [Responsible: Cashier]";

const samples = { ENR_001, ...SEEDED };
const EMPTY_FORM = { processing_steps: '', procedure_mode: 'steps', procedure_steps: [] };
const form = (over = {}) => ({ ...EMPTY_FORM, ...over });
const numbers = (text) => text.split('\n').map((line) => /^Step (\d+)\. /.exec(line)?.[1]);

describe('serializing steps (the existing "Step N. ..." format)', () => {
  it('numbers the steps from 1, one line each, joined with a line feed', () => {
    assert.equal(serializeSteps(['First step', 'Second step', 'Third step']), 'Step 1. First step\nStep 2. Second step\nStep 3. Third step');
    assert.equal(serializeSteps([]), '');
    assert.equal(serializeSteps(['  padded  ']), 'Step 1. padded');
  });

  it('is what the Service Details parser reads back as the same numbered list', () => {
    const parsed = parseProcedureSteps(serializeSteps(['Go to the window', 'Pay the fee', 'Get the receipt']));
    assert.deepEqual(parsed.map((s) => [s.number, s.title, s.location, s.substeps.length]), [[1, 'Go to the window', null, 0], [2, 'Pay the fee', null, 0], [3, 'Get the receipt', null, 0]]);
  });
});

describe('adding, removing and reordering', () => {
  it('Add step appends a blank step; numbering follows the position', () => {
    const steps = addStep(['A', 'B']);
    assert.deepEqual(steps, ['A', 'B', '']);
    assert.deepEqual(numbers(serializeSteps(['A', 'B', 'C'])), ['1', '2', '3']);
  });

  it('removing a step renumbers the rest', () => {
    const steps = removeStep(['A', 'B', 'C'], 1);
    assert.deepEqual(steps, ['A', 'C']);
    assert.equal(serializeSteps(steps), 'Step 1. A\nStep 2. C');
  });

  it('moving a step changes the order and the numbers; the first cannot go up and the last cannot go down', () => {
    assert.deepEqual(moveStep(['A', 'B', 'C'], 2, -1), ['A', 'C', 'B']);
    assert.deepEqual(moveStep(['A', 'B', 'C'], 0, 1), ['B', 'A', 'C']);
    assert.equal(serializeSteps(moveStep(['A', 'B', 'C'], 2, -1)), 'Step 1. A\nStep 2. C\nStep 3. B');
    const steps = ['A', 'B', 'C'];
    assert.equal(moveStep(steps, 0, -1), steps);
    assert.equal(moveStep(steps, 2, 1), steps);
  });

  it('editing one step leaves the others alone', () => {
    assert.deepEqual(setStep(['A', 'B'], 1, 'Bee'), ['A', 'Bee']);
  });

  it('does not change the list it was given', () => {
    const steps = ['A', 'B'];
    addStep(steps); removeStep(steps, 0); moveStep(steps, 0, 1); setStep(steps, 0, 'x');
    assert.deepEqual(steps, ['A', 'B']);
  });
});

describe('what may be saved', () => {
  it('refuses a blank step and names it', () => {
    assert.equal(procedureProblem(form({ procedure_steps: ['A', '', 'C'] })), 'Step 2 is empty. Write it or remove it.');
    assert.equal(procedureProblem(form({ procedure_steps: ['A', '   '] })), 'Step 2 is empty. Write it or remove it.');
    assert.equal(procedureProblem(form({ procedure_steps: ['A', 'B'] })), null);
  });

  it('an empty list is allowed (no procedure)', () => {
    assert.equal(procedureProblem(form()), null);
    assert.equal(procedureForBody(form()), null);
  });

  it('stops at the 10,000 character limit, counted on the serialized text', () => {
    assert.equal(PROCEDURE_LIMIT, 10000);
    // "Step 1. " is 8 characters, so 9,992 characters of step text is exactly 10,000.
    assert.equal(procedureProblem(form({ procedure_steps: ['x'.repeat(9992)] })), null);
    assert.match(procedureProblem(form({ procedure_steps: ['x'.repeat(9993)] })), /10,001 characters\. The limit is 10,000\./);
    // Numbering and line breaks count too.
    assert.match(procedureProblem(form({ procedure_steps: ['x'.repeat(5000), 'y'.repeat(5000)] })), /limit is 10,000/);
    assert.match(procedureProblem(form({ procedure_mode: 'text', processing_steps: 'z'.repeat(10001) })), /10,001 characters/);
    assert.equal(procedureProblem(form({ procedure_mode: 'text', processing_steps: 'z'.repeat(10000) })), null);
  });
});

describe('when the step editor may be used (exact round trip)', () => {
  it('plain numbered lines qualify, and serialize back to exactly the same text', () => {
    for (const text of ['Step 1. Only step', 'Step 1. A\nStep 2. B\nStep 3. C', 'Step 1. Pay at the cashier (Php 150.00)\nStep 2. Get the receipt, then return.']) {
      const steps = parseSimpleSteps(text);
      assert.ok(steps, text);
      assert.equal(serializeSteps(steps), text);
      assert.equal(canUseStepEditor(text), true);
    }
  });

  it('nothing stored, or an empty text, opens the step editor with an empty list', () => {
    for (const none of [null, undefined, '']) assert.deepEqual(initialProcedure(none), { mode: 'steps', steps: [], text: '' });
    assert.equal(canUseStepEditor(null), true);
  });

  it('anything the list would change stays in the text box', () => {
    const notEligible = [
      'Step 1. A\r\nStep 2. B', // Windows line endings
      'Step 1. A\nStep 2. B\n', // trailing line break
      '\nStep 1. A', // leading line break
      'Step 1. A\n\nStep 2. B', // blank line
      'Step 1. A \nStep 2. B', // trailing space
      'Step 1.  A', // two spaces after the dot
      'step 1. A', // different case
      'Step 1: A', // different punctuation
      'Step 1) A',
      'Step 2. A\nStep 3. B', // does not start at 1
      'Step 1. A\nStep 3. B', // numbering skips
      'Step 1. A\nStep 1. B', // repeated number
      'Step 01. A', // leading zero
      'Step 1. A\n  1.1. a sub-step', // sub-step
      'Step 1. A\nsome extra line', // unrecognized line
      'Just a sentence about the procedure.', // not steps at all
      'Step 1. Go to the window Location: Cashier', // location
      'Step 1. Go Notes/Instruction: Bring ID', // instruction
      'Step 1. Accept [Responsible: Cashier]', // responsible person
      '1. First\n2. Second', // another numbering style
      'Step 1.', // no text
    ];
    for (const text of notEligible) {
      assert.equal(parseSimpleSteps(text), null, JSON.stringify(text));
      assert.deepEqual(initialProcedure(text).mode, 'text', JSON.stringify(text));
      assert.equal(initialProcedure(text).text, text);
    }
  });
});

describe('real seeded procedures (copied from the catalogue)', () => {
  it('every sample has sub-steps, locations or responsible persons, so every one stays in the text box', () => {
    for (const [name, text] of Object.entries(samples)) {
      assert.equal(parseSimpleSteps(text), null, name);
      assert.equal(canUseStepEditor(text), false, name);
      const opened = initialProcedure(text);
      assert.equal(opened.mode, 'text', name);
      assert.equal(opened.text, text, name);
    }
  });

  it('opening and saving one unchanged sends the identical text, byte for byte (line endings included)', () => {
    for (const [name, text] of Object.entries(samples)) {
      const opened = procedureFields(text);
      assert.equal(opened.procedure_mode, 'text', name);
      assert.equal(procedureForBody(opened), text, name);
      assert.equal(Buffer.compare(Buffer.from(procedureForBody(opened)), Buffer.from(text)), 0, name);
    }
    assert.ok(Object.values(samples).some((t) => t.includes('\r\n')), 'at least one sample uses Windows line endings');
    assert.ok(Object.values(samples).some((t) => /\n {2}1\.1/.test(t)), 'at least one sample uses numbered sub-steps');
    assert.ok(Object.values(samples).some((t) => /Notes\/Instruction:/.test(t)), 'at least one sample has an instruction');
  });

  it('the Service Details parser still reads them exactly as before', () => {
    const steps = parseProcedureSteps(ENR_001);
    assert.equal(steps.length, 2);
    assert.equal(steps[0].location, 'Director/Head of Academic Program Offices');
    assert.equal(steps[0].substeps.length, 2);
  });

  it('text mode with the text untouched is never converted by saving', () => {
    const fields = procedureFields(ENR_001);
    assert.equal(procedureProblem(fields), null);
    assert.equal(procedureForBody(fields), ENR_001);
    assert.equal(fields.processing_steps, ENR_001);
  });
});

describe('switching between the step editor and the text box', () => {
  it('Edit as text fills the box with the current steps in the numbered format; blank, unsaved steps hold nothing and are left out', () => {
    assert.deepEqual(toTextMode({ procedure_steps: ['A', 'B'] }), { procedure_mode: 'text', processing_steps: 'Step 1. A\nStep 2. B' });
    assert.equal(toTextMode({ procedure_steps: ['A', '', 'B'] }).processing_steps, 'Step 1. A\nStep 2. B');
    assert.equal(toTextMode({ procedure_steps: [] }).processing_steps, '');
  });

  it('steps to text to steps loses nothing', () => {
    const steps = ['Go to the window', 'Pay the fee (Php 150.00)', 'Get the receipt'];
    const asText = toTextMode({ procedure_steps: steps });
    const back = toStepMode({ processing_steps: asText.processing_steps });
    assert.deepEqual(back.procedure_steps, steps);
    assert.equal(toTextMode({ procedure_steps: back.procedure_steps }).processing_steps, asText.processing_steps);
  });

  it('text that cannot be a list cannot switch to the step editor (it stays as text, unchanged)', () => {
    for (const text of Object.values(samples)) assert.equal(toStepMode({ processing_steps: text }), null);
  });

  it('typing text that is plain numbered lines makes the step editor available', () => {
    assert.equal(toStepMode({ processing_steps: 'Step 1. A\nStep 2. B' }).procedure_steps.length, 2);
    assert.deepEqual(toStepMode({ processing_steps: '' }), { procedure_mode: 'steps', procedure_steps: [] });
  });
});

describe('what is sent to the API', () => {
  it('step editor: the numbered text, in the same field and shape as before', () => {
    assert.equal(procedureForBody(form({ procedure_steps: ['A', 'B'] })), 'Step 1. A\nStep 2. B');
  });

  it('text box: exactly what is typed (spaces and all); nothing or only spaces is no procedure', () => {
    assert.equal(procedureForBody(form({ procedure_mode: 'text', processing_steps: '  odd \n text  ' })), '  odd \n text  ');
    for (const blank of ['', '   ', '\n\n']) assert.equal(procedureForBody(form({ procedure_mode: 'text', processing_steps: blank })), null);
  });

  it('renaming a service sends the same procedure text it was opened with', () => {
    for (const text of ['Step 1. A\nStep 2. B', ENR_001, null]) {
      const opened = procedureFields(text);
      assert.equal(procedureForBody(opened), text === null ? null : text);
    }
  });
});

describe('step text is plain text', () => {
  const hostile = ['<img src=x onerror=alert(1)>', '<script>alert("x")</script>', '"><svg onload=alert(1)>', '&lt;b&gt;'];

  it('is stored and read back as the characters typed, never changed, escaped or run', () => {
    const text = serializeSteps(hostile);
    assert.deepEqual(parseSimpleSteps(text), hostile);
    const shown = parseProcedureSteps(text);
    assert.deepEqual(shown.map((s) => s.title), hostile);
  });

  it('no screen renders step content as HTML', () => {
    const root = fileURLToPath(new URL('../../src', import.meta.url));
    const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
    for (const file of walk(root).filter((f) => f.endsWith('.js'))) {
      assert.ok(!/dangerouslySetInnerHTML|innerHTML\s*=/.test(readFileSync(file, 'utf8')), file);
    }
  });
});
