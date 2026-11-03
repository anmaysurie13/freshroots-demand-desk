# Demand Desk

A demand-planning tool for Freshroots, a packaged-snacks and staples distributor in Maharashtra and Goa.
A planner exports five files from SAP twice a week. Rules raise the flags, an AI model explains each one, the planner accepts or changes every decision, and only reviewed decisions reach buying. Two kill switches stop the automation on their own if it stops being trustworthy.

Live: https://freshroots-demand-desk-three.vercel.app

## How it works

```
SAP export (5 CSVs) -> validate -> rule engine -> AI explanation -> planner review -> buying decision -> dashboard -> kill switches
```

- **Rule engine** (`src/lib/engine`): pure functions. The five ordering rules, festival uplift and perishable windows. Every threshold lives in `config/rules.json`.
- **AI step** (`src/lib/ai`): one call per flag. The model may restate and explain the rule engine's decision, never change it. A strict validator checks every answer (schema, allowed action, quantity, no invented numbers, no other SKU). Failures retry twice, then fall back to the rule engine's own decision, badged and excluded from Kill 1.
- **Review**: nothing reaches buying without an explicit accept or reject. A rejection needs a reason and must change something. Reviews are append-only.
- **Kill 1**: at 30+ reviewed AI decisions, a reversal rate of 10% or more stops the automation.
- **Kill 2**: quarter-to-date loss above Rs 28 lakh alerts; above Rs 34 lakh stops the automation. Only Deepa or the CEO can re-arm, with a written reason.

## Stack

Next.js (App Router) and TypeScript, Tailwind, Neon Postgres with Drizzle, Vercel. The AI step calls Gemini through OpenRouter. Buying decisions go to HubSpot as deals.

## Run it locally

```bash
npm install
cp .env.example .env.local        # then fill in the values
npm run db:migrate
npm run db:seed                   # creates one account per role (there are no passwords)
npm run dev
```

Checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run secret-scan`.
End-to-end scripts (`scripts/e2e-phase1.ts`, `e2e-phase2.ts`, `e2e-phase3.ts`) drive a running server over HTTP; point them at a throwaway database branch, never production. The HubSpot script runs against a local mock of HubSpot's API. `scripts/ui-newrun.mjs` clicks through the New Run screen in a real browser.

## Access

There are no passwords. The sign-in page is a role picker, and it works only while `OPEN_ACCESS_DEMO=true`. **While it is on, anyone with the link can act as any role**, including reviewing decisions, entering losses and re-arming kill switches. With it off, nobody can start a session. This suits a demo or an assignment, not real operations.

## Roles

| Role | Can do |
|---|---|
| `raghav` | Upload data, start runs, review every decision |
| `procurement` | See buying decisions, mark orders placed, send decisions to HubSpot, export CSV |
| `priya` | Enter quarterly loss figures, export metrics |
| `deepa`, `ceo` | Read everything, acknowledge alerts, re-arm kill switches |
| `admin` | Manage users; review only as an audited break-glass |

## HubSpot

HubSpot has no purchase orders or inventory, so each pending buying decision becomes one **deal** when procurement clicks "Send to HubSpot". Nothing is sent automatically, and a decision can only ever create one deal. Set `HUBSPOT_ACCESS_TOKEN` (and optionally `HUBSPOT_PIPELINE` and `HUBSPOT_DEAL_STAGE`) to connect; without a token the panel shows "Not connected" and CSV export still works.

## Decisions and interpretations

See [docs/DECISIONS.md](docs/DECISIONS.md) for every place the spec was ambiguous and what this build does.

## Background

The case, the business rules and the sample data come from the Freshroots demand-planning build pack at https://github.com/anshullmishra-png/freshroots_demandplanning. This repository is an independent implementation of that case: its code, structure and interface are written from scratch.
