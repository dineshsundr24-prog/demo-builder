# UX checklist

_Live banking benchmark, 2026-11-25, gpt-4.1-mini, 8 banking briefs (6 mobile, 2 staff portal), after banking steps 1-2. Regenerate: `BENCH_FILE=briefs-banking.json node packages/generator/scripts/benchmark.ts <dir>`, then `node packages/generator/scripts/checklist.ts <dir> docs/v2/BANKING_CHECKLIST.md`. Coverage is a word-match heuristic and advisory._

Screens passing every check: **45 / 70**

| Check | Pass rate |
|---|---|
| Screen has a title (app bar or heading) | 70/70 ✅ |
| At most one action bar; one primary action (mobile) | 70/70 ✅ |
| No buttons duplicating tab bar / back (outcome screens excepted) | 70/70 ✅ |
| No meta or placeholder copy | 70/70 ✅ |
| Success messages only on outcome screens | 70/70 ✅ |
| No empty sections or cards | 70/70 ✅ |
| No duplicated action labels | 70/70 ✅ |
| Inputs live in a form with a submit action | 70/70 ✅ |
| Action labels fit (<= 28 characters) | 70/70 ✅ |
| Real content (no fallback/default content) | 70/70 ✅ |
| Passes schema and binding validation | 70/70 ✅ |
| Reachable and has a way forward/back | 70/70 ✅ |
| Covers the planned requirement items | 45/70 |

| Brief | Channel | Screens | Brand | Cost | Time | Findings |
|---|---|---|---|---|---|---|
| cards-loans-mobile | mobile | 7 | Falcon Bank | $0.0102 | 20s | home: coverage; my-cards: coverage; personal-finance-offer: coverage |
| ididi-mobile | mobile | 5 | IDIDI | $0.0061 | 14s | dashboard: coverage |
| kapiko-mobile | mobile | 12 | Kapiko | $0.0138 | 24s | mobile-otp-verification: coverage; ekyc-using-uae-pass: coverage; my-service-requests: coverage |
| kapiko-portal | portal | 7 | Kapiko | $0.0083 | 16s | completed-applications: coverage |
| nexa-mobile | mobile | 10 | Nexa | $0.0143 | 21s | welcome: coverage; transfer-money: coverage; service-requests: coverage |
| onboarding-mobile | mobile | 13 | Sahra | $0.0137 | 29s | otp-entry: coverage; face-verification: coverage; account-type: coverage; success: coverage; accounts-list: coverage; notifications: coverage; profile: coverage |
| retail-ops-portal | portal | 7 | Gulf Crest | $0.0093 | 23s | customer-360: coverage; request-details: coverage; reports: coverage |
| sme-mobile | mobile | 9 | Oasis Business | $0.0109 | 25s | business-dashboard: coverage; account-details: coverage; payment-receipt: coverage; request-details: coverage |
