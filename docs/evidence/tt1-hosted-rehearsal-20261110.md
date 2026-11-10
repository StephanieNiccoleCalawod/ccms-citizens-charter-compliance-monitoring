# TT1 hosted-copy verification — November 10, 2026

All four hosted service schemas were checked against retained Neon backups and separate rehearsal copies. Production was accessed through read-only transactions only during this verification.

| Service | Retained backup | Backup branch ID | Created (UTC) | Rehearsal |
| --- | --- | --- | --- | --- |
| oversight | pre-tt1-oversight-20261110-integration | br-winter-scene-b3ui389u | 2026-11-10T06:31:43Z | Passed |
| identity | pre-tt1-identity-20261110-integration | br-summer-art-a1qtqaar | 2026-11-10T06:32:50Z | Passed |
| core | pre-tt1-core-20261110-integration | br-summer-haze-a1noe4tj | 2026-11-10T06:33:58Z | Passed |
| operations | pre-tt1-operations-20261110-integration | br-blue-river-b3p8weuw | 2026-11-10T06:36:20Z | Passed |

For every service: baseline adoption changed only migration bookkeeping; original record checksums were preserved after numbered migrations; the retained backup remained unchanged. Full table counts and checksums are retained in private release evidence, not published with application source.

## Migrations verified on copies

### oversight

- OversightBaseline1793491200000

### identity

- IdentityBaseline1793491200000
- Cc046AccountPosition1794225600000
- Cc046TrimmedPosition1794300400000

### core

- CoreBaseline1793491200000
- Cc048OfficeSchedules1794300000000

### operations

- OperationsBaseline1793491200000
- Cc050TransactionOutcome1794182400000
- Cc046StartedByPosition1794225600000
- Cc046StarterName1794300100000
- Cc051OutsideHours1794300200000
- Cc038ForecastRuns1794300300000

## Validation

- All-workspace lint and server-time checks passed.
- Migration/runtime acceptance suite: 42 passed; additional integration safeguards: 4 passed.
- Combined outside-hours, starter-label and forecast behavior: 59 passed.
- Backend builds passed; the frontend Webpack production build passed. Windows Turbopack hit a worker-process issue; Linux CI and Vercel builds remain release gates.

## Release boundary

These results cover the candidate based on deployment commit e70fd8d, including the newly numbered schedules, labels, flag, forecast, and position-check migrations. No mock data was imported. Production migration and deployment evidence must be recorded separately after release.
