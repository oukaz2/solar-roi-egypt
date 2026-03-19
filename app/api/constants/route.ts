import { NextResponse } from "next/server";
import { REGION_LABELS, REGION_YIELDS, TARIFF_LABELS, DEFAULT_TARIFFS, ESCALATION_LABELS, ESCALATION_PRESETS } from "@/lib/constants";

export async function GET() {
  return NextResponse.json({
    regions: Object.entries(REGION_LABELS).map(([key, label]) => ({
      key, label, specificYield: REGION_YIELDS[key],
    })),
    tariffs: Object.entries(TARIFF_LABELS).map(([key, label]) => ({
      key, label, defaultValue: DEFAULT_TARIFFS[key] ?? null,
    })),
    escalations: Object.entries(ESCALATION_LABELS).map(([key, label]) => ({
      key, label, rate: ESCALATION_PRESETS[key],
    })),
  });
}
