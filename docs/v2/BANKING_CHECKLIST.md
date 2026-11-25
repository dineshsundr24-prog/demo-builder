# UX checklist

_Live banking benchmark, 2026-11-25, gpt-4.1-mini, 8 banking briefs (6 mobile, 2 staff portal). Regenerate: `BENCH_FILE=briefs-banking.json node packages/generator/scripts/benchmark.ts <dir>`, then `node packages/generator/scripts/checklist.ts <dir> docs/v2/BANKING_CHECKLIST.md`. Coverage is a word-match heuristic and advisory._

Screens passing every check: **44 / 67**

| Check | Pass rate |
|---|---|
| Screen has a title (app bar or heading) | 67/67 ✅ |
| At most one action bar; one primary action (mobile) | 67/67 ✅ |
| No buttons duplicating tab bar / back (outcome screens excepted) | 67/67 ✅ |
| No meta or placeholder copy | 67/67 ✅ |
| Success messages only on outcome screens | 67/67 ✅ |
| No empty sections or cards | 67/67 ✅ |
| No duplicated action labels | 67/67 ✅ |
| Inputs live in a form with a submit action | 67/67 ✅ |
| Action labels fit (<= 28 characters) | 67/67 ✅ |
| Real content (no fallback/default content) | 67/67 ✅ |
| Passes schema and binding validation | 67/67 ✅ |
| Reachable and has a way forward/back | 67/67 ✅ |
| Covers the planned requirement items | 44/67 |

| Brief | Channel | Screens | Brand | Cost | Time | Findings |
|---|---|---|---|---|---|---|
| cards-loans-mobile | mobile | 7 | Falcon | $0.0089 | 86s | my-cards: coverage; personal-finance-offer: coverage; application-submitted: coverage; pay-bills: coverage |
| ididi-mobile | mobile | 5 | IDIDI | $0.0057 | 12s | welcome: coverage |
| kapiko-mobile | mobile | 12 | Kapiko | $0.0135 | 21s | mobile-otp-verification: coverage; ekyc-using-uae-pass: coverage; face-verification: coverage; dashboard: coverage; income-verification-review: coverage; income-update-confirmation: coverage; customer-profile: coverage |
| kapiko-portal | portal | 7 | Kapiko | $0.0085 | 16s | reports: coverage |
| nexa-mobile | mobile | 10 | Nexa | $0.0134 | 22s | bill-payment: coverage; service-requests: coverage |
| onboarding-mobile | mobile | 10 | Sahra | $0.0108 | 21s | face-verification: coverage; review-terms: coverage; success: coverage; dashboard: coverage |
| retail-ops-portal | portal | 7 | Gulf Crest | $0.0096 | 22s | all checks pass |
| sme-mobile | mobile | 9 | Oasis Business | $0.0104 | 20s | business-dashboard: coverage; payment-receipt: coverage; suppliers-list: coverage; service-requests-list: coverage |
