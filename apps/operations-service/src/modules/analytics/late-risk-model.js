import { createHash } from 'node:crypto';

export const MINIMUM_LATE_CASES = 60;
export const MODEL_THRESHOLDS = Object.freeze({ medium: 0.30, high: 0.60 });
export const RULE_THRESHOLDS = Object.freeze({ medium: 0.50, high: 0.80 });
const CLASSIFICATIONS = ['SIMPLE', 'COMPLEX', 'HIGHLY_TECHNICAL'];

// Separate fixed hash namespaces keep sampling and the hold-out independent and reproducible.
function uniform(id, purpose) {
  return createHash('sha256').update(`cc052:v1:${purpose}:${id}`).digest().readUInt32BE() / 2 ** 32;
}

export const sampleFraction = (id) => 0.10 + 0.90 * uniform(id, 'sample');
const heldOut = (id) => uniform(id, 'holdout') < 0.20;
const sigmoid = (score) => 1 / (1 + Math.exp(-score));
const ratio = (numerator, denominator) => denominator ? numerator / denominator : 0;

export function features({ share, classification, pace, load, onHold, weekday }) {
  return [share, ...CLASSIFICATIONS.map((value) => Number(classification === value)), pace, load, Number(onHold),
    ...Array.from({ length: 7 }, (_, index) => Number(weekday === index))];
}

export function classify(value, thresholds) {
  if (value >= thresholds.high) return 'HIGH';
  if (value >= thresholds.medium) return 'MEDIUM';
  return 'LOW';
}

export function predict(model, values) {
  const contributions = values.map((value, index) => model.weights[index] * (value - model.means[index]) / model.scales[index]);
  return { probability: sigmoid(contributions.reduce((sum, value) => sum + value, model.intercept)), contributions };
}

export function train(rows) {
  const training = rows.filter((row) => !heldOut(row.id));
  const holdout = rows.filter((row) => heldOut(row.id));
  const lateCases = training.filter((row) => row.late).length;
  const summary = { rows: rows.length, trainingRows: training.length, holdoutRows: holdout.length, lateCases };
  if (lateCases < MINIMUM_LATE_CASES || lateCases === training.length || !holdout.length) {
    return { ...summary, status: 'INSUFFICIENT_DATA', model: null, metrics: null };
  }

  const means = training[0].values.map((_, index) => training.reduce((sum, row) => sum + row.values[index], 0) / training.length);
  const scales = means.map((mean, index) => Math.sqrt(training.reduce((sum, row) => sum + (row.values[index] - mean) ** 2, 0) / training.length) || 1);
  const inputs = training.map((row) => row.values.map((value, index) => (value - means[index]) / scales[index]));
  const weights = means.map(() => 0);
  let intercept = Math.log(lateCases / (training.length - lateCases));

  for (let iteration = 0; iteration < 450; iteration += 1) {
    const gradient = weights.map(() => 0);
    let bias = 0;
    inputs.forEach((values, row) => {
      const error = sigmoid(values.reduce((sum, value, index) => sum + value * weights[index], intercept)) - Number(training[row].late);
      bias += error;
      values.forEach((value, index) => { gradient[index] += error * value; });
    });
    weights.forEach((weight, index) => { weights[index] = weight - 0.12 * (gradient[index] / training.length + 0.01 * weight); });
    intercept -= 0.12 * bias / training.length;
  }

  const model = { version: 1, means, scales, weights, intercept };
  let correct = 0;
  let truePositive = 0;
  let predictedLate = 0;
  let actualLate = 0;
  for (const row of holdout) {
    const late = predict(model, row.values).probability >= 0.5;
    correct += Number(late === row.late);
    truePositive += Number(late && row.late);
    predictedLate += Number(late);
    actualLate += Number(row.late);
  }
  return { ...summary, status: 'TRAINED', model, metrics: {
    accuracy: ratio(correct, holdout.length), precision: ratio(truePositive, predictedLate), recall: ratio(truePositive, actualLate),
  } };
}
