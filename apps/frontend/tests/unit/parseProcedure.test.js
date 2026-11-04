import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseDocumentNotes, parseProcedureSteps, splitLinks } from '../../src/lib/ui/parseProcedure.js';

const ENR_001 =
  "Step 1. Go to the Director/Head of Academic Program for signature and tagging of subject Location: Director/Head of Academic Program Offices\r\n  1.1. Accept, evaluate, and sign the ACE form (Adding of Subjects). [Responsible: Director/Head of Academic Program]\r\n  1.2. Tag the subject(s). [Responsible: Director/Head of Academic Program]\r\nStep 2. Proceed to Cashier's Office to pay the assessed fee (for students not covered by R.A. 10931) Location: CDO Cashier/Accounting Office\r\n  2. Accept payment and issue official receipt [Responsible: Cashier]";

describe('parseProcedureSteps', () => {
  it('parses steps, locations, asides, substeps and responsible roles', () => {
    const steps = parseProcedureSteps(ENR_001);
    assert.equal(steps.length, 2);
    assert.equal(steps[0].title, 'Go to the Director/Head of Academic Program for signature and tagging of subject');
    assert.equal(steps[0].location, 'Director/Head of Academic Program Offices');
    assert.equal(steps[0].substeps.length, 2);
    assert.equal(steps[0].substeps[0].label, '1.1');
    assert.deepEqual(steps[0].substeps[0].roles, ['Director/Head of Academic Program']);
    assert.equal(steps[1].aside, '(for students not covered by R.A. 10931)');
    assert.equal(steps[1].substeps[0].text, 'Accept payment and issue official receipt');
  });

  it('splits several responsible roles and instructions', () => {
    const steps = parseProcedureSteps('Step 1. Submit form Location: Window Notes/Instruction: Bring ID\n  1.1. Accept [Responsible: Staff; Registrar]');
    assert.equal(steps[0].location, 'Window');
    assert.equal(steps[0].instruction, 'Bring ID');
    assert.deepEqual(steps[0].substeps[0].roles, ['Staff', 'Registrar']);
  });

  it('returns null for text that does not follow the format, so the page shows it as written', () => {
    assert.equal(parseProcedureSteps('Go to the office and pay.'), null);
    assert.equal(parseProcedureSteps('Step 1. Go\nrandom continuation line'), null);
    assert.equal(parseProcedureSteps(''), null);
    assert.equal(parseProcedureSteps(null), null);
  });
});

describe('parseDocumentNotes', () => {
  it('extracts copies, where to secure and remarks', () => {
    const parsed = parseDocumentNotes('(1) Original Copy And (2) Photo Copy. Where to secure: PUP - https://example.test/forms. Remarks: Downloadable from https://example.test/forms');
    assert.equal(parsed.copies, '(1) Original Copy And (2) Photo Copy');
    assert.equal(parsed.where, 'PUP - https://example.test/forms');
    assert.equal(parsed.remarks, 'Downloadable from https://example.test/forms');
  });

  it('handles a single label and returns null for unlabelled notes', () => {
    assert.deepEqual(parseDocumentNotes('Where to secure: www.pup.edu.ph'), { copies: null, where: 'www.pup.edu.ph', remarks: null });
    assert.equal(parseDocumentNotes('Bring two copies'), null);
    assert.equal(parseDocumentNotes(null), null);
  });
});

describe('splitLinks', () => {
  it('only turns http(s) addresses into links', () => {
    assert.deepEqual(splitLinks('See https://a.test/x. or javascript:alert(1)'), [
      { text: 'See ' },
      { href: 'https://a.test/x' },
      { text: ' or javascript:alert(1)' },
    ]);
  });
});
