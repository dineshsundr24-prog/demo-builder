# Generation quality: RCA fixes and benchmark (branch v2/quality)

Trigger: UAT job `8ac2784f` (IDIDI BANK) produced poor screens (RCA shared with the owner on 24 Nov 2026).

## What changed
| RCA | Fix |
|---|---|
| RC5: `1) Welcome screen` lists not recognised; extra screens and renamed titles | Parser accepts `1)`, `1.` and "… screen" lists when the brief is about screens; titles are the BA's; planner cannot add screens |
| RC4: UAE PASS forced onto "standard sign in" | Journey templates are offered only when the brief mentions them; new standard sign-in and sign-up templates; prompts de-biased (any industry) |
| RC3/RC6: AI composed low-level boxes; broken layouts | Designed pattern library (Hero, BalanceCard, QuickActions, TransactionList, MenuList, ProfileHeader, ActionBar, StatusTimeline, Promo) with icons; renderer rules: full-width blocks, stacked mobile actions, minimal bar on focused flows, no duplicate titles, readable long numbers |
| RC1/RC7: validity was mistaken for quality | Deterministic design clean-up (button rows → ActionBar, card-wrapped figures → BalanceCard/KPI, one logo, self-links, single-brace bindings, wrong form ids, unknown formatters); requirement-coverage check (`mustInclude`) that triggers one repair; actions inside patterns are validated |
| RC8: model and critic | Benchmarked gpt-4.1 vs gpt-4.1-mini (below) |
| RC2: misleading evidence | Benchmark with 6 fixed briefs (4 not Kapiko, 2 not banking) and rendered contact sheets reviewed before any deploy |
| Owner request | Optional brand assets: logo upload, 8 palettes or custom colours, font; live re-styling in the studio |

## Benchmark (24 Nov 2026, real OpenAI runs, `packages/generator/scripts/benchmark.ts`)
| Pipeline / model | Apps completed | Screens valid / repaired / fallback | Avg cost per app | Avg time | UAE PASS forced on briefs that didn't ask |
|---|---|---|---|---|---|
| Before (v2/foundation), gpt-4.1-mini | 6/6 | 55 / 4 / 0 * | USD 0.023 | 23 s | 4 |
| **After, gpt-4.1-mini** | **6/6** | **26 / 22 / 0** | **USD 0.029** | **34 s** | **0** |
| After, gpt-4.1 | 6/6 | 42 / 8 / 4 | USD 0.152 | 66 s | 0 |

\* The old pipeline only checked structure, so "valid" there included the screens the owner rejected. The new checks are stricter: most repairs add missing requirement items.

IDIDI brief, exact titles: before `Welcome to IDIDI BANK, Sign In to Your Account, Create a New IDIDI BANK Account, Your Account Dashboard, Update Your Income Details, Application Settings` (6, one invented); after `Welcome, Standard Sign In, Standard Sign Up, Dashboard, Income` (5, as written).

**Model decision: keep gpt-4.1-mini.** gpt-4.1 cost 5× more, and all 4 of its fallbacks were runaway outputs cut off at the length limit.

## Known remaining issues
- An occasional generic sample name ("John Doe") despite the rule.
- Confirmation/review screens show "—" for values the user has not entered yet. Correct in a click-through, sparse when opened directly.
- Repairs are frequent (about half of screens, almost all for requirement coverage). Cost impact is +USD 0.006 per app.
