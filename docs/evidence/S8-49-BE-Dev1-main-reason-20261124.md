# S8-49 / CC052–CC053: backend main reason

Implemented locally November 24, 2026 (Asia/Manila). Scope: BE Dev 1 only. Adds `main_reason_code` to each transaction item returned by `GET /api/analytics/late-risk?officeId=...` while retaining the existing `reason` sentence.

## Developer validation and selection

The proposed reason code is feasible: the trained logistic model already calculates per-feature contributions and scoring already selects the largest positive contribution for the reason sentence. The implementation exposes that choice as a stable code. Each contribution is `weight * (value - training_mean) / training_scale`, a contribution to the model's log-odds score, not an independent probability or proof of causation.

- Trained model: choose the greatest strictly positive contribution. Equal values keep the first feature in the existing feature order.
- When every feature contribution is zero or negative: return `MODEL_BASELINE`. Previously the sentence fell back to time used despite the model having no positive time-share contribution. The new sentence explicitly states that no individual factor increases the score. The model intercept and protective contributions still determine the probability and level.
- Rule fallback: return the code for the rule that actually applied to the unrounded time-used share. High starts at 80%; Medium starts at 50%; Low is below 50%.

| Code | Meaning |
| --- | --- |
| `TIME_SHARE_HIGH` | Rule: at least 80% of allowed working time used |
| `TIME_SHARE_MEDIUM` | Rule: at least 50%, below 80%, used |
| `TIME_SHARE_LOW` | Rule: below 50% used |
| `TIME_SHARE` | Trained model: time-used share is the strongest positive feature contribution |
| `SERVICE_SIMPLE` | Trained model: standardized simple-service indicator contribution |
| `SERVICE_COMPLEX` | Trained model: standardized complex-service indicator contribution |
| `SERVICE_HIGHLY_TECHNICAL` | Trained model: standardized highly-technical-service indicator contribution |
| `SERVICE_OFFICE_PACE` | Trained model: historical service/office pace contribution |
| `OFFICE_WORKLOAD` | Trained model: office workload contribution |
| `ON_HOLD` | Trained model: standardized hold-state indicator contribution |
| `WORKING_WEEKDAY` | Trained model: one of the seven standardized weekday indicators |
| `MODEL_BASELINE` | No individual feature increases the score relative to its training mean |
| `MAIN_REASON_UNAVAILABLE` | An older trained cache lacks the saved reason code and cannot currently be refreshed |

Indicator codes identify model feature contributions relative to training means. They do not prove the transaction currently has the indicated category or that workload/hold caused a delay. No hold duration or staff identity is invented.

Example rule-based item fields:

```json
{
  "level": "HIGH",
  "main_reason_code": "TIME_SHARE_HIGH",
  "reason": "85% of the time limit used",
  "rule_based": true
}
```

## Cache and access behavior

The code is saved in the existing JSON score-cache payload. Caches without codes are refreshed even within their normal 60-second TTL. If the calendar fails, existing stale scores remain available: a legacy rule cache can derive its code from its saved rule level; a legacy trained cache returns `MAIN_REASON_UNAVAILABLE`, because original feature contributions were not saved. Current caches preserve their saved codes on both cached and stale reads.

The change adds no raw feature values or contributions to the response. Existing office-scope checks and probability gating remain in place. Staff identity is still removed from score responses, including Executive responses. `can_open` remains the existing read permission, and no staff action or notification endpoint was added.

No migration, retraining, production data write, or frontend modification is required. This change is not deployed by this review.

## Verification

| Check | Result |
| --- | --- |
| Focused S8-49, S8-46 provenance, and S8-09 feature privacy tests | **13 passed, 0 failed** |
| Existing pure late-risk model tests | **3 passed** |
| Existing DB scoring/cache/batching/RBAC tests | **4 cancelled by failed setup hook:** `connect EACCES 127.0.0.1:55432` |
| Docker availability | Access denied to the Docker Desktop Linux API pipe in this session |
| Targeted ESLint on implementation and new reason-code tests | Passed |
| Additional ESLint on the extended existing DB test file | Did not finish after several minutes; stopped, not recorded as passing |
| Syntax checks and tracked diff whitespace check | Passed |

Focused command from repository root:

```powershell
node --test apps/operations-service/test/s8-49-main-reason.test.js apps/operations-service/test/s8-46-calculations.test.js apps/operations-service/test/s8-09-no-client-features.test.js
```

The new tests exercise all 14 model-feature positions, positive-versus-negative and standardized contribution selection, deterministic ties, baseline explanations, exact rule boundaries, new/legacy cache refresh and stale behavior, and Executive privacy. Existing DB tests were extended to check codes on fresh, cached, stale, and trained responses, but those assertions could not run here because the database connection was denied.

To finish DB-backed verification in the environment with the test PostgreSQL server running:

```powershell
node --test apps/operations-service/test/late-risk.test.js
```

Files changed: `apps/operations-service/src/modules/analytics/late-risk.js`, `apps/operations-service/test/late-risk.test.js`, and new `apps/operations-service/test/s8-49-main-reason.test.js`. The frontend cards, redesign, filters, and action buttons were not assessed. The entire S8-49 item is not marked Done by this backend implementation.
