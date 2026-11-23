// What the Late-Risk screens say about the scoring model, from the `model` object Operations returns with the scores
// ({ method: 'trained' | 'rule-based', status, trained_at, rows, training_rows, late_cases, metrics, thresholds }, read from the
// latest late_risk_runs row). Pure functions, so the rule can be tested without a browser.
//
// TT5 / S8-09: a model's accuracy figures belong to a model that is actually scoring. When the scores come from the rules
// (never trained, too little history, last run failed, or the last run is more than seven days old) no metric is shown and the
// screen says so in plain words, with the reason.

export const RULE_BASED_TEXT = 'scores use the rule-based Citizen’s Charter time-limit thresholds.';

/** True only when a trained model is the one scoring right now. */
export const isTrainedModel = (model) => model?.method === 'trained';

/** The accuracy, precision and recall figures are shown only for a trained model that has them. */
export const showModelMetrics = (model) => isTrainedModel(model) && Boolean(model?.metrics);

/** Why the rules are scoring, as one sentence; null for a trained model (nothing to explain). */
export function ruleBasedNote(model) {
  if (!model || isTrainedModel(model)) return null;
  switch (model.status) {
    case 'INSUFFICIENT_DATA': return `Not enough history to train a model yet (it needs at least 60 late cases), so ${RULE_BASED_TEXT}`;
    case 'FAILED': return `The last training attempt failed, so ${RULE_BASED_TEXT}`;
    case 'STALE': return `The last successful training is more than seven days old, so ${RULE_BASED_TEXT} They return to the model once it is retrained.`;
    default: return `No model has been trained yet, so ${RULE_BASED_TEXT}`;
  }
}
