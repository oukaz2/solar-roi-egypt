# SolarROI Egypt — C&I Proposal Generator

A full-stack Next.js + TypeScript SaaS app for Egyptian Commercial & Industrial solar integrators. Input project parameters, run deterministic financial analysis, and download a branded 3-page PDF proposal.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v3 + shadcn/ui |
| ORM | Prisma (SQLite dev → Postgres prod) |
| Forms | react-hook-form + Zod |
| Charts | Recharts (client-side cashflow chart) |
| PDF | PDFKit (server-side, 3-page branded proposal) |
| Deployment | Vercel |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env and set DATABASE_URL if needed (default: SQLite)

# 3. Create / migrate the database
npx prisma generate
npx prisma db push

# 4. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Prisma connection string | `file:./dev.db` (SQLite) |

To switch to Postgres:
1. Change `provider = "sqlite"` → `provider = "postgresql"` in `prisma/schema.prisma`
2. Set `DATABASE_URL` to your Postgres connection string
3. Run `npx prisma db push`

---

## Financial Model

All calculations live in `lib/financialEngine.ts` — a pure TypeScript function with no side effects.

### Inputs

| Parameter | Description |
|---|---|
| `systemSizeKwp` | System capacity in kWp |
| `region` | Solar resource zone (see yields below) |
| `capexPerKwp` | Capital cost in EGP/kWp |
| `oAndMPercent` | Annual O&M as % of total CAPEX |
| `tariffValue` | Electricity avoided tariff in EGP/kWh |
| `escalationRate` | Annual tariff escalation (fraction) |
| `financingMode` | `"cash"` or `"loan"` |
| `loanParams` | `{ loanShare, interestRate, tenorYears }` — loan mode only |
| `analysisPeriod` | Default 25 years |
| `discountRate` | Default 11% (set per EPC profile) |

### Regional Specific Yields

| Region | Yield (kWh/kWp/yr) |
|---|---|
| North (Alexandria / North Coast) | 1,550 |
| Cairo / Delta / Canal Zone | 1,650 |
| Upper Egypt / Aswan / Luxor | 1,800 |

### Tariff Escalation Presets

| Scenario | Annual Rate |
|---|---|
| Flat | 0% |
| Moderate | 7.5% |
| High inflation | 17.5% |

### Outputs

- **Simple Payback** — first year cumulative CF ≥ 0 (fractional interpolation)
- **NPV (EGP)** — discounted at the EPC's configured discount rate
- **IRR** — bisection method, range −99.99% to +500%
- **Annual Production** — kWh/yr (no degradation in MVP)
- **Annual Cashflows** — array for Recharts chart
- **Cumulative Cashflows** — array for payback reference line

### Loan Model

Standard equal-payment annuity:

```
annuity = L × [r × (1+r)^n] / [(1+r)^n − 1]
```

where `L = loanShare × totalCapex`, `r = interestRate`, `n = tenorYears`.

---

## Pages

| Route | Description |
|---|---|
| `/` | Dashboard — KPI summary + recent proposals |
| `/setup` | EPC profile setup — name, email, logo, brand color, discount rate |
| `/projects` | All proposals list with key metrics |
| `/projects/new` | New proposal form with full validation |
| `/projects/[id]` | Results view — KPI cards + Recharts chart + assumptions tables |

## API Routes

| Method | Route | Description |
|---|---|---|
| GET | `/api/constants` | Returns all model constants |
| GET/POST | `/api/epcs` | List / create EPC profiles |
| GET/PATCH | `/api/epcs/[id]` | Get / update an EPC profile |
| POST | `/api/epcs/[id]/logo` | Upload EPC logo (multipart) |
| GET/POST | `/api/projects` | List / create projects (engine runs on POST) |
| GET | `/api/projects/[id]` | Get a single project |
| GET | `/api/projects/[id]/pdf` | Generate & stream PDF proposal |
| POST | `/api/calculate` | Stateless financial calculation (no DB write) |

---

## PDF Proposal

Generated server-side via PDFKit (`app/api/projects/[id]/pdf/route.ts`).

3 pages:
1. **Cover** — EPC logo, brand color header, client name, site, system size
2. **Executive Summary** — KPI table (payback, NPV, IRR, production, CAPEX)
3. **Assumptions & Cashflow** — All inputs + year-by-year cashflow table

---

## Defaults

| Parameter | Default Value |
|---|---|
| CAPEX/kWp | EGP 9,000 |
| O&M | 1% of CAPEX/yr |
| Analysis period | 25 years |
| Discount rate | 11% |
| Loan share | 70% of CAPEX |
| Interest rate | 18% p.a. |
| Loan tenor | 7 years |

---

## Development Notes

- **`financingParams`** stored as JSON string in SQLite (`Prisma` doesn't support JSON for SQLite). Always `JSON.parse()` when reading.
- **PDF route** uses `require("pdfkit")` (CommonJS) to avoid ESM issues. Has `export const dynamic = "force-dynamic"`.
- **`next.config.ts`** lists `pdfkit`, `@prisma/client`, `prisma` as `serverComponentsExternalPackages`.
- **EPC context** is React state only (no localStorage — SSR-safe).
- **Dark mode** toggled via `document.documentElement.classList` (ThemeProvider in `components/Providers.tsx`).

---

## Extending the Model

To add panel degradation (0.5%/yr):
```ts
// In financialEngine.ts, replace:
const avoidedGridCost = annualProduction * escalatedTariff;
// with:
const degradedProduction = annualProduction * Math.pow(1 - 0.005, t - 1);
const avoidedGridCost = degradedProduction * escalatedTariff;
```

To add income tax:
```ts
const taxableCF = avoidedGridCost - annualOM;
const cf = taxableCF * (1 - taxRate) - debtThisYear;
```

---

Built with [Perplexity Computer](https://www.perplexity.ai/computer).
