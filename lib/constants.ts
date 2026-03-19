/**
 * Solar ROI Egypt – All model constants
 * ======================================
 * To adjust tariffs, yields, or the discount rate, edit ONLY this file.
 */

// ── Regional specific yields (kWh/kWp/year) ──────────────────────────────────
export const REGION_YIELDS: Record<string, number> = {
  north:        1550,  // Alexandria, North Coast
  cairo_delta:  1650,  // Cairo, Nile Delta, Canal Zone
  upper_egypt:  1800,  // Upper Egypt, Aswan, Luxor
};

export const REGION_LABELS: Record<string, string> = {
  north:        "North (Alexandria / North Coast)",
  cairo_delta:  "Cairo / Delta",
  upper_egypt:  "Upper Egypt / Aswan",
};

// ── Default tariffs (EGP/kWh) ─────────────────────────────────────────────────
export const DEFAULT_TARIFFS: Record<string, number> = {
  industrial_mv: 2.00,
  commercial_mv: 2.20,
};

export const TARIFF_LABELS: Record<string, string> = {
  industrial_mv: "Industrial MV (default ~2.00 EGP/kWh)",
  commercial_mv: "Commercial MV (default ~2.20 EGP/kWh)",
  custom:        "Custom tariff",
};

// ── Tariff escalation presets (annual rate as fraction) ───────────────────────
export const ESCALATION_PRESETS: Record<string, number> = {
  "0":    0.000,
  "7.5":  0.075,
  "17.5": 0.175,
};

export const ESCALATION_LABELS: Record<string, string> = {
  "0":    "0% per year (flat tariff)",
  "7.5":  "5–10% per year (use 7.5%)",
  "17.5": "15–20% per year (use 17.5%)",
};

// ── Analysis defaults ──────────────────────────────────────────────────────────
export const DEFAULT_ANALYSIS_PERIOD = 25;
export const DEFAULT_DISCOUNT_RATE   = 0.11;   // 11% WACC/hurdle rate
export const DEFAULT_CAPEX_PER_KWP   = 9000;   // EGP/kWp (2024 Egypt market)
export const DEFAULT_OM_PERCENT      = 1.0;    // % of CAPEX per year

// ── Loan defaults ──────────────────────────────────────────────────────────────
export const DEFAULT_LOAN_SHARE    = 0.70;  // 70% financed
export const DEFAULT_INTEREST_RATE = 0.18;  // 18% EGP bank rate (approx)
export const DEFAULT_LOAN_TENOR    = 7;     // years
