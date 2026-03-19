/**
 * Solar ROI Financial Engine – Egypt C&I
 * ========================================
 * Pure function, no side effects, no I/O.
 * Runs on Next.js server (API routes + PDF) and in the browser (live charts).
 *
 * To extend the model:
 *   - Add degradation: multiply annualProduction by (1 - 0.005)^(t-1) each year
 *   - Add tax: deduct (cf * taxRate) from each CF
 *   - Add multi-tranche debt: replace computeAnnuity with a full amortisation table
 */

import { REGION_YIELDS, DEFAULT_ANALYSIS_PERIOD, DEFAULT_DISCOUNT_RATE } from "./constants";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface LoanParams {
  loanShare: number;    // fraction of CAPEX, e.g. 0.70
  interestRate: number; // annual rate, e.g. 0.18
  tenorYears: number;   // loan tenor in years, e.g. 7
}

export interface EngineInputs {
  systemSizeKwp:  number;
  region:         string;       // key in REGION_YIELDS
  capexPerKwp:    number;       // EGP/kWp
  oAndMPercent:   number;       // e.g. 1.0 = 1% of CAPEX
  tariffValue:    number;       // EGP/kWh (already resolved)
  escalationRate: number;       // fraction e.g. 0.075
  financingMode:  "cash" | "loan";
  loanParams?:    LoanParams;
  analysisPeriod?: number;      // default 25
  discountRate?:   number;      // default 0.11
}

export interface FinancialResult {
  simplePayback:       number | null;  // years, null if never recovered
  npv:                 number;         // EGP
  irr:                 number | null;  // fraction e.g. 0.22 = 22%
  annualProduction:    number;         // kWh/year
  totalCapex:          number;         // EGP
  annualCashflows:     number[];       // CF for each year 1..analysisPeriod
  cumulativeCashflows: number[];       // running cumulative CF
  annualDebtService:   number;         // 0 for cash mode
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Standard annuity (equal annual payment) for loan L at rate r over n years */
function computeAnnuity(principal: number, rate: number, tenorYears: number): number {
  if (rate === 0) return principal / tenorYears;
  const r = rate;
  return principal * (r * Math.pow(1 + r, tenorYears)) / (Math.pow(1 + r, tenorYears) - 1);
}

/**
 * IRR via Newton–Raphson bisection.
 * Returns null if no real IRR found in [-99%, +500%].
 */
function computeIRR(cashflows: number[]): number | null {
  const maxIter = 1000;
  const tol = 1e-6;
  const npvAt = (rate: number) =>
    cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);

  let lo = -0.9999, hi = 5.0;
  const fLo = npvAt(lo);
  const fHi = npvAt(hi);
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(mid);
    if (Math.abs(fMid) < tol || (hi - lo) / 2 < tol) return mid;
    if (fLo * fMid < 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

function computeNPV(cashflows: number[], discountRate: number): number {
  return cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + discountRate, t), 0);
}

/** Simple payback: first year where cumulative CF >= 0, with fractional interpolation */
function computeSimplePayback(annualCFs: number[], initialInvestment: number): number | null {
  let cumulative = -initialInvestment;
  for (let t = 0; t < annualCFs.length; t++) {
    cumulative += annualCFs[t];
    if (cumulative >= 0) {
      const prevCum = cumulative - annualCFs[t];
      return t + (-prevCum / annualCFs[t]);
    }
  }
  return null;
}

// ── Main Engine ───────────────────────────────────────────────────────────────
export function runFinancialEngine(inputs: EngineInputs): FinancialResult {
  const {
    systemSizeKwp, region, capexPerKwp, oAndMPercent,
    tariffValue, escalationRate, financingMode, loanParams,
    analysisPeriod = DEFAULT_ANALYSIS_PERIOD,
    discountRate = DEFAULT_DISCOUNT_RATE,
  } = inputs;

  const specificYield   = REGION_YIELDS[region] ?? 1650;
  const annualProduction = systemSizeKwp * specificYield;
  const totalCapex       = systemSizeKwp * capexPerKwp;
  const annualOM         = totalCapex * (oAndMPercent / 100);

  let annualDebtService = 0;
  if (financingMode === "loan" && loanParams) {
    const { loanShare, interestRate, tenorYears } = loanParams;
    annualDebtService = computeAnnuity(loanShare * totalCapex, interestRate, tenorYears);
  }

  const initialEquity = financingMode === "loan" && loanParams
    ? totalCapex * (1 - loanParams.loanShare)
    : totalCapex;

  const annualCashflows: number[]     = [];
  const cumulativeCashflows: number[] = [];
  let cumSum = 0;

  for (let t = 1; t <= analysisPeriod; t++) {
    const escalatedTariff  = tariffValue * Math.pow(1 + escalationRate, t);
    const avoidedGridCost  = annualProduction * escalatedTariff;
    const debtThisYear     = financingMode === "loan" && loanParams && t <= loanParams.tenorYears
      ? annualDebtService : 0;
    const cf = avoidedGridCost - annualOM - debtThisYear;
    annualCashflows.push(cf);
    cumSum += cf;
    cumulativeCashflows.push(cumSum);
  }

  const allCFs = [-initialEquity, ...annualCashflows];

  return {
    simplePayback:       computeSimplePayback(annualCashflows, initialEquity),
    npv:                 computeNPV(allCFs, discountRate),
    irr:                 computeIRR(allCFs),
    annualProduction,
    totalCapex,
    annualCashflows,
    cumulativeCashflows,
    annualDebtService,
  };
}
