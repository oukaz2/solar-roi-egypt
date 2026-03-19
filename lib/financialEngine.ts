/**
 * Solar ROI Financial Engine – Egypt C&I  (V2)
 * ============================================
 * Pure function, no side effects, no I/O.
 * Runs on Next.js server (API routes + PDF) and in the browser (live charts).
 *
 * V2 additions:
 *   - Self-consumption ratio: split production between on-site use and export
 *   - Export tariff: revenue for surplus electricity sent to the grid
 *   - Panel degradation: 0.5 %/yr (compound) on production
 *   - CO₂ savings: Egypt grid emission factor 0.45 kg CO₂/kWh
 */

import { REGION_YIELDS, DEFAULT_ANALYSIS_PERIOD, DEFAULT_DISCOUNT_RATE } from "./constants";

// ── Constants ────────────────────────────────────────────────────────────────
export const DEGRADATION_RATE    = 0.005;  // 0.5 % per year
export const CO2_FACTOR_KG_KWH   = 0.45;  // Egypt grid average (kg CO₂ / kWh)

// ── Types ─────────────────────────────────────────────────────────────────────
export interface LoanParams {
  loanShare:    number;   // fraction of CAPEX, e.g. 0.70
  interestRate: number;   // annual rate, e.g. 0.18
  tenorYears:   number;   // loan tenor in years, e.g. 7
}

export interface EngineInputs {
  systemSizeKwp:       number;
  region:              string;        // key in REGION_YIELDS
  capexPerKwp:         number;        // EGP/kWp
  oAndMPercent:        number;        // e.g. 1.0 = 1% of CAPEX
  tariffValue:         number;        // EGP/kWh — grid purchase tariff (avoided cost)
  escalationRate:      number;        // fraction e.g. 0.075
  financingMode:       "cash" | "loan";
  loanParams?:         LoanParams;
  analysisPeriod?:     number;        // default 25
  discountRate?:       number;        // default 0.11
  // V2 fields (all optional for backwards compatibility)
  consumptionKwh?:     number;        // annual site consumption kWh (0 = no limit → 100% self-consumed)
  selfConsumptionRatio?: number;      // fraction of eligible production used on-site, default 0.8
  exportTariff?:       number;        // EGP/kWh for surplus exported to grid, default 0.0
}

export interface FinancialResult {
  simplePayback:        number | null;  // years, null if never recovered
  npv:                  number;         // EGP
  irr:                  number | null;  // fraction e.g. 0.22 = 22%
  annualProductionY1:   number;         // kWh/year (year-1, before degradation)
  annualProductionAvg:  number;         // kWh/year average over analysis period
  totalCapex:           number;         // EGP
  annualCashflows:      number[];       // CF for each year 1..analysisPeriod
  cumulativeCashflows:  number[];       // running cumulative CF
  annualDebtService:    number;         // 0 for cash mode
  // V2 additions
  selfConsumedKwhY1:    number;         // kWh self-consumed in year 1
  exportedKwhY1:        number;         // kWh exported in year 1
  co2SavedTonnes:       number;         // total lifetime CO₂ avoided (tonnes)
  // Legacy alias (used by existing UI/PDF code that references annualProduction)
  annualProduction:     number;         // == annualProductionY1
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Standard annuity (equal annual payment) for loan L at rate r over n years */
function computeAnnuity(principal: number, rate: number, tenorYears: number): number {
  if (rate === 0) return principal / tenorYears;
  const r = rate;
  return principal * (r * Math.pow(1 + r, tenorYears)) / (Math.pow(1 + r, tenorYears) - 1);
}

/**
 * IRR via bisection.
 * Returns null if no real IRR found in [-99%, +500%].
 */
function computeIRR(cashflows: number[]): number | null {
  const maxIter = 1000;
  const tol     = 1e-6;
  const npvAt   = (rate: number) =>
    cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);

  let lo = -0.9999, hi = 5.0;
  const fLo = npvAt(lo);
  const fHi = npvAt(hi);
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < maxIter; i++) {
    const mid  = (lo + hi) / 2;
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
    analysisPeriod    = DEFAULT_ANALYSIS_PERIOD,
    discountRate      = DEFAULT_DISCOUNT_RATE,
    consumptionKwh    = 0,       // 0 means no consumption cap → all production usable
    selfConsumptionRatio = 0.8,
    exportTariff      = 0.0,
  } = inputs;

  const specificYield    = REGION_YIELDS[region] ?? 1650;
  const annualProdY1     = systemSizeKwp * specificYield;   // year-1, no degradation
  const totalCapex       = systemSizeKwp * capexPerKwp;
  const annualOM         = totalCapex * (oAndMPercent / 100);

  // Self-consumption split for year 1 (used for display)
  // If consumptionKwh is 0 (not set), treat as unconstrained (production fully eligible)
  const eligibleProdY1   = consumptionKwh > 0
    ? Math.min(annualProdY1, consumptionKwh)
    : annualProdY1;
  const selfConsumedY1   = eligibleProdY1 * selfConsumptionRatio;
  const exportedY1       = annualProdY1 - selfConsumedY1;

  let annualDebtService = 0;
  if (financingMode === "loan" && loanParams) {
    const { loanShare, interestRate, tenorYears } = loanParams;
    annualDebtService = computeAnnuity(loanShare * totalCapex, interestRate, tenorYears);
  }

  const initialEquity = financingMode === "loan" && loanParams
    ? totalCapex * (1 - loanParams.loanShare)
    : totalCapex;

  const annualCashflows:     number[] = [];
  const cumulativeCashflows: number[] = [];
  let cumSum       = 0;
  let totalKwhSaved = 0;

  for (let t = 1; t <= analysisPeriod; t++) {
    // Panel degradation: year t production
    const degradationFactor = Math.pow(1 - DEGRADATION_RATE, t - 1);
    const prodThisYear      = annualProdY1 * degradationFactor;

    // Self-consumption split
    const eligibleThisYear    = consumptionKwh > 0
      ? Math.min(prodThisYear, consumptionKwh)
      : prodThisYear;
    const selfConsumedThisYear = eligibleThisYear * selfConsumptionRatio;
    const exportedThisYear     = prodThisYear - selfConsumedThisYear;

    // Revenue with tariff escalation
    const escalatedGridTariff  = tariffValue   * Math.pow(1 + escalationRate, t);
    const escalatedExportTariff = exportTariff * Math.pow(1 + escalationRate, t);
    const avoidedCost  = selfConsumedThisYear * escalatedGridTariff;
    const exportRevenue = exportedThisYear    * escalatedExportTariff;
    const revenue      = avoidedCost + exportRevenue;

    const debtThisYear = financingMode === "loan" && loanParams && t <= loanParams.tenorYears
      ? annualDebtService : 0;
    const cf = revenue - annualOM - debtThisYear;

    annualCashflows.push(cf);
    cumSum += cf;
    cumulativeCashflows.push(cumSum);

    // CO₂: all energy produced displaces grid electricity (whether self-consumed or exported)
    totalKwhSaved += prodThisYear;
  }

  const avgProd = totalKwhSaved / analysisPeriod;
  const allCFs  = [-initialEquity, ...annualCashflows];

  return {
    simplePayback:       computeSimplePayback(annualCashflows, initialEquity),
    npv:                 computeNPV(allCFs, discountRate),
    irr:                 computeIRR(allCFs),
    annualProductionY1:  annualProdY1,
    annualProductionAvg: avgProd,
    annualProduction:    annualProdY1,  // legacy alias
    totalCapex,
    annualCashflows,
    cumulativeCashflows,
    annualDebtService,
    selfConsumedKwhY1:   selfConsumedY1,
    exportedKwhY1:       exportedY1,
    co2SavedTonnes:      (totalKwhSaved * CO2_FACTOR_KG_KWH) / 1000,
  };
}
