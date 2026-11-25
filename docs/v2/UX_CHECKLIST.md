# UX checklist

_Live run on 2026-11-25, gpt-4.1-mini, archetype engine (branch v2/archetypes). Regenerate with `node packages/generator/scripts/benchmark.ts <dir>` then `node packages/generator/scripts/checklist.ts <dir> docs/v2/UX_CHECKLIST.md`. Coverage is a word-match heuristic and advisory._

Screens passing every check: **47 / 61**

| Check | Pass rate |
|---|---|
| Screen has a title (app bar or heading) | 61/61 ✅ |
| At most one action bar; one primary action (mobile) | 61/61 ✅ |
| No buttons duplicating tab bar / back (outcome screens excepted) | 61/61 ✅ |
| No meta or placeholder copy | 61/61 ✅ |
| Success messages only on outcome screens | 61/61 ✅ |
| No empty sections or cards | 61/61 ✅ |
| No duplicated action labels | 61/61 ✅ |
| Inputs live in a form with a submit action | 61/61 ✅ |
| Action labels fit (<= 28 characters) | 61/61 ✅ |
| Real content (no fallback/default content) | 61/61 ✅ |
| Passes schema and binding validation | 61/61 ✅ |
| Reachable and has a way forward/back | 61/61 ✅ |
| Covers the planned requirement items | 47/61 |

| Brief | Channel | Screens | Brand | Cost | Time | Findings |
|---|---|---|---|---|---|---|
| clinic-mobile | mobile | 10 | CareWell | $0.0110 | 18s | dashboard-home: coverage; appointment-detail: coverage; appointment-book: coverage; prescriptions-list: coverage; profile: coverage |
| hr-leave-portal | portal | 7 | PeopleFirst | $0.0085 | 17s | dashboard: coverage |
| ididi-mobile | mobile | 5 | IDIDI | $0.0059 | 13s | all checks pass |
| kapiko-mobile | mobile | 12 | Kapiko Bank | $0.0134 | 21s | ekyc-using-uae-pass: coverage; dashboard: coverage; customer-profile: coverage |
| kapiko-portal | portal | 7 | Kapiko | $0.0086 | 14s | reports: coverage |
| nexa-mobile | mobile | 10 | Nexa | $0.0134 | 21s | identity-verification: coverage; service-requests: coverage |
| safedrive-mobile | mobile | 10 | SafeDrive | $0.0111 | 19s | claims-list: coverage; profile: coverage |
