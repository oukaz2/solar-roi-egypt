import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runFinancialEngine } from "@/lib/financialEngine";
import { ESCALATION_PRESETS, REGION_YIELDS, DEFAULT_TARIFFS } from "@/lib/constants";
import type { LoanParams } from "@/lib/financialEngine";

export async function GET(req: NextRequest) {
  const epcId = req.nextUrl.searchParams.get("epcId");
  const where = epcId ? { epcId: Number(epcId) } : {};
  const projects = await prisma.project.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();

    const epcId = Number(b.epcId);
    const epc   = await prisma.epc.findUnique({ where: { id: epcId } });
    const discountRate = epc?.discountRate ?? 0.11;

    // Resolve tariff value
    const tariffValue: number = b.tariffType !== "custom"
      ? (DEFAULT_TARIFFS[b.tariffType] ?? 2.0)
      : Number(b.tariffValue);

    const exportTariff        = Number(b.exportTariff ?? 0);
    const consumptionKwh      = Number(b.consumptionKwh ?? 0);
    const selfConsumptionRatio = Number(b.selfConsumptionRatio ?? 0.8);

    const loanParams: LoanParams | undefined =
      b.financingMode === "loan" && b.financingParams
        ? (typeof b.financingParams === "string"
            ? JSON.parse(b.financingParams)
            : b.financingParams)
        : undefined;

    const result = runFinancialEngine({
      systemSizeKwp:       Number(b.systemSizeKwp),
      region:              b.region,
      capexPerKwp:         Number(b.capexPerKwp),
      oAndMPercent:        Number(b.oAndMPercent),
      tariffValue,
      escalationRate:      ESCALATION_PRESETS[b.escalationScenario] ?? 0,
      financingMode:       b.financingMode ?? "cash",
      loanParams,
      analysisPeriod:      Number(b.analysisPeriod) || 25,
      discountRate,
      consumptionKwh,
      selfConsumptionRatio,
      exportTariff,
    });

    const project = await prisma.project.create({
      data: {
        epcId,
        clientName:           b.clientName,
        siteName:             b.siteName,
        city:                 b.city,
        systemSizeKwp:        Number(b.systemSizeKwp),
        capexPerKwp:          Number(b.capexPerKwp),
        oAndMPercent:         Number(b.oAndMPercent),
        region:               b.region,
        specificYield:        REGION_YIELDS[b.region] ?? 1650,
        tariffType:           b.tariffType,
        tariffValue,
        exportTariff,
        escalationScenario:   b.escalationScenario,
        consumptionKwh,
        selfConsumptionRatio,
        financingMode:        b.financingMode ?? "cash",
        financingParams:      loanParams ? JSON.stringify(loanParams) : null,
        analysisPeriod:       Number(b.analysisPeriod) || 25,
        simplePayback:        result.simplePayback,
        npv:                  result.npv,
        irr:                  result.irr,
        annualProduction:     result.annualProductionY1,
      },
    });

    return NextResponse.json({ project, result }, { status: 201 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ message: e.message }, { status: 500 });
  }
}
