// S8-09 AC4 / K28: no client identity (name, email, registry number, client type) is a feature of the late-risk model or the forecast.
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { features } from '../src/modules/analytics/late-risk-model.js';

const root = new URL('../src/', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const FORBIDDEN = /client_[a-z_]+|complainant|e-?mail|registry|full_name|started_by/i;

describe('S8-09 no client identity as a model feature', () => {
  it('the late-risk feature vector has only the 14 agreed inputs, and extra client fields change nothing', () => {
    const base = { share: 0.4, classification: 'COMPLEX', pace: 1.1, load: 0.9, onHold: false, weekday: 2 };
    const withClient = { ...base, client_email: 'a@b.test', client_reference: '2023-00123-QC-0', client_type: 'STUDENT', full_name: 'Ana Cruz', started_by: 'x' };
    assert.equal(features(base).length, 14);
    assert.deepEqual(features(withClient), features(base));
  });

  it('the late-risk model code mentions no client, complainant, email, registry or staff identity field', () => {
    assert.doesNotMatch(read('modules/analytics/late-risk-model.js'), FORBIDDEN);
  });

  it('the forecast code reads only dates and counts, with no client identity field', () => {
    for (const file of readdirSync(new URL('lib/forecast/', root))) assert.doesNotMatch(read(`lib/forecast/${file}`), FORBIDDEN, file);
  });
});
