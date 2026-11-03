# Demand Desk

A demand-planning tool for Freshroots, a packaged-snacks and staples distributor in Maharashtra and Goa.
A planner exports five files from SAP twice a week. Rules raise the flags, an AI model explains each one, the planner accepts or changes every decision, and only reviewed decisions reach buying. Two kill switches stop the automation on their own if it stops being trustworthy.

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

Next.js (App Router) and TypeScript, Tailwind, Neon Postgres with Drizzle, Vercel, GitHub Actions. The AI step calls Gemini through OpenRouter.

## Run it locally

```bash
npm install
cp .env.example .env.local        # then fill in the values
npm run db:migrate
npm run db:seed                   # creates one account per role; passwords go to .seed-credentials.txt
npm run dev
```

Checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run secret-scan`.
End-to-end scripts (`scripts/e2e-phase1.ts`, `scripts/e2e-phase2.ts`) drive a running server over HTTP; point them at a throwaway database branch, never production.

## Roles

| Role | Can do |
|---|---|
| `raghav` | Upload data, start runs, review every decision |
| `procurement` | See buying decisions, mark orders placed, export CSV |
| `priya` | Enter quarterly loss figures, export metrics |
| `deepa`, `ceo` | Read everything, acknowledge alerts, re-arm kill switches |
| `admin` | Manage users; review only as an audited break-glass |

## Decisions and interpretations

See [docs/DECISIONS.md](docs/DECISIONS.md) for every place the spec was ambiguous and what this build does.

## Background

The case, the business rules and the sample data come from the Freshroots demand-planning build pack at https://github.com/anshullmishra-png/freshroots_demandplanning. This repository is an independent implementation of that case: its code, structure and interface are written from scratch.
