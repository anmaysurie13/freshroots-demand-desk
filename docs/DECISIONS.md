# Decisions and interpretations

The case leaves some things open. This is what the build does in each place, so nothing is silent. Thresholds live in `config/rules.json`; changing one is a config change plus a version bump, no code change.

## Rules

| # | Question | What this build does |
|---|---|---|
| 1 | May the AI differ from the rule engine's action or quantity? | No. `ai.deviationPolicy` is `none`: the validator rejects any difference. A `bounded` mode (quantity within a percentage) exists behind the same setting but is off. |
| 2 | Is the 12-week average taken over the last 12 weeks including the last 4? | Yes, it includes them (W31 to W42 on the sample data). |
| 3 | How does the 25% festival uplift apply? | Average weekly sales are multiplied by 1.25 before any cover threshold. The demand ratio is unaffected because both sides carry the uplift. The month of the inventory `As_Of_Date` decides, read from `calendar.csv`. |
| 4 | Do perishable limits (3 and 4 weeks) replace 6 and 14? | They replace them for `Perishability = High`. |
| 5 | Reorder quantity | Stockout alone: 1.0 x standard quantity. High demand (with or without stockout): 1.5 x. The highest multiplier wins. Rounded half up to whole units. |
| 6 | High demand together with overstock | Both flags shown, action is pause, quantity 0, and it needs judgment. |
| 7 | What counts as "needs judgment" (the cases rules cannot cover) | Conflicting flags; fewer than 12 weeks of history; a zero-sales week in the last 12; a sales swing above 50% between two consecutive weeks inside the last 4. |
| 8 | SKUs with no sales history | Not evaluated (a new launch cannot be scored). Listed on the Review page and as a validation warning, never silently dropped. |

## Kill switches

| # | Question | What this build does |
|---|---|---|
| 9 | What is a "reversal"? | A rejection where the final action or quantity differs from the AI's. A rejection that only changes the flag is saved and counts as a reviewed decision, but not as a reversal. Fallback decisions are excluded from both counts. |
| 10 | Kill 1 window | Cumulative since go-live or the last re-arm. Needs 30 reviewed decisions. Fires at 10% or more (exactly 10% fires). |
| 11 | What is a quarter, and which quarter does an entry belong to? | Calendar quarters (Jan to Mar is Q1). An entry belongs to the quarter where its period starts, and a period cannot cross a quarter. |
| 12 | What a kill does | New runs and the AI step stop; unreviewed AI decisions are voided; unplaced buying decisions become `held` (not cancelled); in-flight runs become `blocked`; a banner shows on every page; email is queued. |
| 13 | Re-arming | Only `deepa` or `ceo`, with a written reason of 20+ characters. Kill 1 restarts its count; Kill 2 keeps its loss entries and warns (and needs a confirmation) when the loss is still above the kill level. A killed state survives a quarter change until re-armed. |
| 14 | Held orders | Procurement can place a held item only after ticking "I confirmed with Raghav". |
| 15 | Email | Only a `console` provider exists. Messages are written to the `email_outbox` table (visible on the Safety page). No real mail is sent until a provider is added. |

## Data and review

| # | Question | What this build does |
|---|---|---|
| 16 | Stock-versus-peak warning | The written spec says 3x and the spec's config says 15x. This build uses 15x (`data.stockVsPeakWarnMultiple`). It is a warning only. |
| 17 | Sample data is dated 2026-10-19 | Real uploads are blocked when inventory is more than 7 days old. The built-in sample data skips that one check and says so as a warning, so the demo works at any date. |
| 18 | More than one inventory row per SKU, or mixed as-of dates | Blocked as errors. One row per SKU is supported. |
| 19 | Reject with final action "No action" | The review is saved (and counts as a reversal), but no buying decision is created because there is nothing to buy. |
| 20 | Upload size | 1 MB per CSV (`data.maxFileBytes`). Vercel limits request bodies to about 4.5 MB, so the written 5 MB limit could not hold. |
| 21 | Who can bulk accept | `raghav`, and `admin` as an audited break-glass. Needs-judgment, fallback and non-pending rows are always refused. |

## Platform

| # | Question | What this build does |
|---|---|---|
| 22 | AI provider | Gemini through OpenRouter (`google/gemini-3.8-flash`, chosen from OpenRouter's live model list on 2026-11-03). A `mock` provider exists for offline use. |
| 23 | Sign-in | None, by request. A role picker, allowed only while `OPEN_ACCESS_DEMO` is exactly `true`; otherwise nobody can start a session. While it is on, anyone with the link can act as any role. A session is a signed, httpOnly cookie, and the role is re-read from the database on every request. |
| 24 | Accounts | One per role, seeded with placeholder `@freshroots.example` emails and no passwords. The picker uses the first active account of each role. Real emails need confirming. |
| 25 | Cron | One daily call to `/api/cron/kill2`, protected by `CRON_SECRET`. |
| 26 | CI | The workflow is in `docs/ci-workflow.yml`. Move it to `.github/workflows/ci.yml` once the GitHub login has the `workflow` scope. |
| 27 | Database branches | Production uses the Neon `production` branch. Development and the end-to-end scripts use a separate `dev` branch. |

## HubSpot (replaces the Zoho placeholder)

| # | Question | What this build does |
|---|---|---|
| 28 | What does HubSpot do with a buying decision? | HubSpot has no purchase orders or inventory, so each pending decision becomes one **deal**. Procurement triggers it with a button; it is never automatic. Held, placed and already-sent decisions are skipped. |
| 29 | Duplicate deals | HubSpot documents no idempotency key. Each decision is claimed atomically before the call and keeps its deal id, so two clicks at once, or a retry after a failure, cannot create two deals. A failed call releases the claim so it can be retried. |
| 30 | Which deal fields | Only documented ones: `dealname` (the action, SKU and run) and, when configured, `pipeline` and `dealstage`. No `amount`, because the data has no prices. No custom or `description` property, because HubSpot's docs do not confirm `description` exists on deals. |
| 31 | Things HubSpot's docs do not state | Checked against a real account on 2026-11-03: the scope is `crm.objects.deals.write` (shown in the HubSpot UI), and a deal with only `dealname` is accepted (HTTP 201) and lands in the default pipeline and stage, so `HUBSPOT_PIPELINE` and `HUBSPOT_DEAL_STAGE` are optional. The global host `api.hubapi.com` accepted a token from the NA2 data center. |
| 32 | Token | A HubSpot **service key** (Development > Keys > Service Keys) named `demand-desk` with only the `crm.objects.deals.write` scope, stored as a sensitive Production variable on Vercel. HubSpot's docs say legacy private apps cannot be created after 26 October 2026, which is why a service key was used. |
| 33 | Tested against | The unit and end-to-end tests use a local mock of HubSpot's API. The token was also checked once against the real API by creating and archiving one test deal. The in-app "Send to HubSpot" button has not been clicked against the live account. |
