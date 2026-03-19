import { NextRequest, NextResponse } from "next/server";
import { runFinancialEngine } from "@/lib/financialEngine";
import { ESCALATION_PRESETS } from "@/lib/constants";
import type { LoanParams } from "@/lib/financialEngine";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const result = runFinancialEngine({
      systemSizeKwp:  Number(b.systemSizeKwp),
      region:         b.region,
      capexPerKwp:    Number(b.capexPerKwp),
      oAndMPercent:   Number(b.oAndMPercent),
      tariffValue:    Number(b.tariffValue),
      escalationRate: ESCALATION_PRESETS[b.escalationScenario] ?? 0,
      financingMode:  b.financingMode,
      loanParams:     b.financingMode === "loan" ? (b.financingParams as LoanParams) : undefined,
      analysisPeriod: Number(b.analysisPeriod) || 25,
      discountRate:   Number(b.discountRate) || 0.11,
    });
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: 400 });
  }
}
