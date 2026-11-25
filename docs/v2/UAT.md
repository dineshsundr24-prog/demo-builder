# Demo Builder v2: UAT preview

## What gets deployed (free plan, isolated from v1)
`render.yaml` defines two **new** Render services built from `v2/foundation`:

| Service | Type | Purpose |
|---|---|---|
| `demo-builder-v2-studio` | Static site (free) | The Studio you test in the browser |
| `demo-builder-v2-api` | Node web service (free, Singapore) | AI generation API, backed by the `meyon-demo-builder` Supabase project |

The v1 services (`demo-builder-nonprod`, `demo-builder-ai-nonprod`) are not in the blueprint and are not changed. Auto-deploy is **off**, so the preview stays stable while you test. The AI budget is hard-capped at **USD 5/month** (`MONTHLY_AI_BUDGET_USD`).

## One-time setup in Render (about 5 minutes)
1. Render Dashboard → **New** → **Blueprint** → choose repository `dineshsundr24-prog/demo-builder`, branch **`v2/foundation`**.
2. Render lists the two services above. Enter the two secrets it asks for:
   - `OPENAI_API_KEY`: the same OpenAI key as the v1 backend.
   - `SUPABASE_SECRET_KEY`: the `meyon-demo-builder` project's secret key (Project Settings → API Keys).
3. Click **Apply**. The first build takes a few minutes.
4. Open `demo-builder-v2-api` → **Environment** and copy the generated `DEMO_ACCESS_TOKEN`. This is your Studio sign-in token.

If Render appends a suffix to a service name (because the name is taken), the blueprint still wires the API and studio together automatically.

## Testing
Open the studio URL (e.g. `https://demo-builder-v2-studio.onrender.com`).

1. **Start screen:** choose **Mobile application** or **Staff portal**.
2. The panel shows "Connected · model … · storage supabase · AI spend this month …".
   - On the free plan the API sleeps after 15 minutes idle. If it says it can't reach the API, wait about a minute and reopen the panel.
3. Paste the access token. Enter a project name, company and **your own business requirements**:
   - Numbered screens (`1. **Title:** details` or `Screen 1: Title`) are kept exactly.
   - Free-form text lets the AI propose the screens.
4. **Draft plan** (about 1 cent). Edit titles and descriptions, add or remove screens, then **Approve and generate**.
5. Watch per-screen progress, tokens and cost. Screens marked *needs attention* can be **regenerated** individually or with **Retry failed screens**.
6. Close the panel to preview. Click through screens in the phone or portal frame, or use the screen list on the left. **Restart demo** resets entered data.
7. **Download JSON** saves the generated app; attach it to feedback.
8. **Open a previous generation** reopens any earlier job (stored in Supabase).

## What to report
For each test: the brief you used, the job time and cost, which screens were wrong or missing, and what you expected (screenshot plus downloaded JSON).

## Known limitations of this preview
- No visual editing yet (Phase 3). Changes happen by editing the plan and regenerating screens.
- One shared access token, no per-user accounts (Phase 6). Use fictional data only.
- The free API instance sleeps when idle (first request after idle takes about 1 minute).

## Editing (Phase 3)
- **Edit mode:** click any component on the screen to change it in the Properties panel. Layers lets you reorder components by drag and drop. Add inserts components. Undo/redo with Ctrl+Z.
- **AI assistant** (toolbar, or *Add screen*): describe a change ("rename Verify to Validate", "add an Emirates ID field") or a new screen ("card management: freeze card, change PIN"). Review the listed changes, then Keep or Undo. Each request costs about USD 0.002–0.004 and counts against the monthly budget.
- **Journey templates** (sign-in, OTP, eKYC…): use *Customise texts and buttons* to edit their parts by hand. The AI assistant does this automatically.
- **Open in new window** presents the demo full-size and follows edits live. Edits are kept in this browser; use *Download JSON* to keep or share a copy.

## Saved demos and versions (Phase A1)
- **Sign in** (or use the shared UAT access token) to save demos. Generated demos are saved automatically; imported or example demos have a **Save to my demos** button.
- **Autosave.** The draft saves itself after each edit. If the same demo was changed in another window, the sidebar says **Changed elsewhere** and offers to load the latest draft; nothing is overwritten silently.
- **Save version** keeps a fixed, numbered snapshot. From a version you can **Publish** (a read-only link that anyone with it can open; shown once, revocable), **Restore** (back into the draft; undo works) or **Fork** (a new independent demo).
- **Primary.** One demo per application type is the primary baseline; use **Make primary** to change it.
- **Start page.** Your saved demos are listed there.
