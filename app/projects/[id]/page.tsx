"use client";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useEpc } from "@/components/Providers";
import { runFinancialEngine } from "@/lib/financialEngine";
import {
  REGION_LABELS,
  ESCALATION_LABELS,
  TARIFF_LABELS,
  ESCALATION_PRESETS,
} from "@/lib/constants";
import type { ProjectData, LoanParams } from "@/lib/types";
import { Download, ArrowLeft, TrendingUp, Clock, DollarSign, BarChart2, Leaf, Zap } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number, decimals = 0) {
  return new Intl.NumberFormat("en-EG", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  unit,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between mb-2">
          <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            {label}
          </div>
          <div className="rounded-md p-1.5 bg-primary/10">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        </div>
        <div
          className="kpi-value text-foreground"
          data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {value}
          {unit && (
            <span className="text-base font-normal text-muted-foreground ml-1">
              {unit}
            </span>
          )}
        </div>
        {sub && (
          <div className="text-xs text-muted-foreground mt-1">{sub}</div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Chart Tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-lg text-xs">
      <div className="font-semibold mb-1">Year {label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-mono font-medium">EGP {fmt(p.value, 0)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ProjectResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { activeEpc } = useEpc();

  const { data: project, isLoading } = useQuery<ProjectData>({
    queryKey: ["/api/projects", id],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Project not found.
      </div>
    );
  }

  // Re-run engine client-side for chart data
  const loanParams: LoanParams | undefined =
    project.financingMode === "loan" && project.financingParams
      ? (typeof project.financingParams === "string"
          ? JSON.parse(project.financingParams)
          : project.financingParams)
      : undefined;

  const engineResult = runFinancialEngine({
    systemSizeKwp:        project.systemSizeKwp,
    region:               project.region,
    capexPerKwp:          project.capexPerKwp,
    oAndMPercent:         project.oAndMPercent,
    tariffValue:          project.tariffValue,
    escalationRate:       ESCALATION_PRESETS[project.escalationScenario] ?? 0,
    financingMode:        (project.financingMode as "cash" | "loan") ?? "cash",
    loanParams,
    analysisPeriod:       project.analysisPeriod,
    discountRate:         activeEpc?.discountRate ?? 0.11,
    consumptionKwh:       (project as any).consumptionKwh ?? 0,
    selfConsumptionRatio: (project as any).selfConsumptionRatio ?? 0.8,
    exportTariff:         (project as any).exportTariff ?? 0,
  });

  const chartData = engineResult.annualCashflows.map((cf, i) => ({
    year: i + 1,
    "Annual CF": cf,
    "Cumulative CF": engineResult.cumulativeCashflows[i],
  }));

  const brandColor = activeEpc?.brandColor ?? "#0d6e74";

  const handleDownloadPdf = async () => {
    const res = await fetch(`/api/projects/${id}/pdf`);
    if (!res.ok) {
      alert("PDF generation failed — check server logs.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().split("T")[0].replace(/-/g, "");
    a.download = `SolarProposal_${project.clientName}_${today}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selfConsumptionRatio = (project as any).selfConsumptionRatio ?? 0.8;
  const exportTariff         = (project as any).exportTariff ?? 0;

  return (
    <div className="max-w-4xl space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/projects">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground h-7 px-2"
                data-testid="button-back"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </Button>
            </Link>
          </div>
          <h1 className="text-xl font-semibold">{project.clientName}</h1>
          <p className="text-sm text-muted-foreground">
            {project.siteName} · {project.city} ·{" "}
            {fmt(project.systemSizeKwp, 1)} kWp
          </p>
        </div>
        <Button
          className="gap-2 shrink-0"
          onClick={handleDownloadPdf}
          style={{ backgroundColor: brandColor }}
          data-testid="button-download-pdf"
        >
          <Download className="w-4 h-4" />
          Download PDF Proposal
        </Button>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Simple Payback"
          value={
            engineResult.simplePayback !== null
              ? fmt(engineResult.simplePayback, 1)
              : ">25"
          }
          unit="yrs"
          sub="from first year"
          icon={Clock}
        />
        <KpiCard
          label="NPV"
          value={`EGP ${fmt(engineResult.npv / 1e6, 2)}M`}
          sub={`at ${((activeEpc?.discountRate ?? 0.11) * 100).toFixed(0)}% discount`}
          icon={DollarSign}
        />
        <KpiCard
          label="IRR"
          value={
            engineResult.irr !== null
              ? `${fmt(engineResult.irr * 100, 1)}%`
              : "N/A"
          }
          sub="internal rate of return"
          icon={TrendingUp}
        />
        <KpiCard
          label="Production Y1"
          value={`${fmt(engineResult.annualProductionY1 / 1000, 1)} GWh`}
          sub={`${fmt(engineResult.annualProductionY1, 0)} kWh/yr`}
          icon={BarChart2}
        />
        <KpiCard
          label="Self-Consumed Y1"
          value={`${fmt(engineResult.selfConsumedKwhY1 / 1000, 1)} GWh`}
          sub={`${fmt(selfConsumptionRatio * 100, 0)}% on-site ratio`}
          icon={Zap}
        />
        <KpiCard
          label="CO₂ Avoided"
          value={`${fmt(engineResult.co2SavedTonnes, 0)}t`}
          sub={`over ${project.analysisPeriod} years`}
          icon={Leaf}
        />
      </div>

      {/* ── Self-consumption breakdown ── */}
      {((project as any).consumptionKwh > 0 || selfConsumptionRatio < 1) && (
        <Card>
          <CardHeader className="pb-2 px-5 pt-5">
            <CardTitle className="text-sm font-semibold">Energy Split (Year 1)</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Total Production</div>
                <div className="text-lg font-mono font-semibold text-primary">{fmt(engineResult.annualProductionY1, 0)} kWh</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Self-Consumed</div>
                <div className="text-lg font-mono font-semibold text-green-600">{fmt(engineResult.selfConsumedKwhY1, 0)} kWh</div>
                <div className="text-xs text-muted-foreground">avoids EGP {fmt(project.tariffValue, 3)}/kWh</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Exported</div>
                <div className="text-lg font-mono font-semibold text-blue-600">{fmt(engineResult.exportedKwhY1, 0)} kWh</div>
                <div className="text-xs text-muted-foreground">
                  {exportTariff > 0 ? `earns EGP ${fmt(exportTariff, 3)}/kWh` : "export tariff: not set"}
                </div>
              </div>
            </div>
            {/* Visual bar */}
            <div className="mt-3 h-3 rounded-full bg-muted overflow-hidden flex">
              <div
                className="h-full bg-green-500 rounded-l-full transition-all"
                style={{ width: `${(engineResult.selfConsumedKwhY1 / engineResult.annualProductionY1) * 100}%` }}
              />
              <div
                className="h-full bg-blue-400 rounded-r-full"
                style={{ width: `${(engineResult.exportedKwhY1 / engineResult.annualProductionY1) * 100}%` }}
              />
            </div>
            <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Self-consumed ({fmt((engineResult.selfConsumedKwhY1 / engineResult.annualProductionY1) * 100, 0)}%)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Exported ({fmt((engineResult.exportedKwhY1 / engineResult.annualProductionY1) * 100, 0)}%)</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Cashflow Chart ── */}
      <Card>
        <CardHeader className="pb-2 px-5 pt-5">
          <CardTitle className="text-sm font-semibold">
            Cashflow Profile (EGP)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Annual cashflow bars + cumulative cashflow line · Payback year marked
          </p>
        </CardHeader>
        <CardContent className="px-2 pb-5" data-testid="chart-cashflow">
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart
              data={chartData}
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
              />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                label={{
                  value: "Year",
                  position: "insideBottomRight",
                  offset: -5,
                  fontSize: 11,
                }}
              />
              <YAxis
                tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine
                y={0}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={1}
              />
              {engineResult.simplePayback !== null && (
                <ReferenceLine
                  x={Math.ceil(engineResult.simplePayback)}
                  stroke={brandColor}
                  strokeDasharray="4 4"
                  label={{
                    value: `Payback yr ${engineResult.simplePayback.toFixed(1)}`,
                    fill: brandColor,
                    fontSize: 10,
                  }}
                />
              )}
              <Bar
                dataKey="Annual CF"
                fill={brandColor}
                opacity={0.75}
                radius={[2, 2, 0, 0]}
              />
              <Line
                type="monotone"
                dataKey="Cumulative CF"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Assumptions ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 px-5 pt-5">
            <CardTitle className="text-sm font-semibold">
              System &amp; Production
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <table
              className="w-full text-sm"
              data-testid="table-system-assumptions"
            >
              <tbody className="divide-y divide-border">
                {[
                  ["System size", `${fmt(project.systemSizeKwp, 1)} kWp`],
                  ["Total CAPEX", `EGP ${fmt(engineResult.totalCapex, 0)}`],
                  ["CAPEX/kWp",   `EGP ${fmt(project.capexPerKwp, 0)}/kWp`],
                  ["Annual O&M",  `EGP ${fmt((engineResult.totalCapex * project.oAndMPercent) / 100, 0)}/yr`],
                  ["Region",      REGION_LABELS[project.region] ?? project.region],
                  ["Specific yield", `${fmt(project.specificYield, 0)} kWh/kWp/yr`],
                  ["Production (Y1)", `${fmt(engineResult.annualProductionY1, 0)} kWh/yr`],
                  ["Avg production",  `${fmt(engineResult.annualProductionAvg, 0)} kWh/yr`],
                  ["Panel degradation", "0.5%/yr"],
                  ["CO₂ avoided", `${fmt(engineResult.co2SavedTonnes, 0)} tonnes`],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-1.5 text-muted-foreground text-xs">{k}</td>
                    <td className="py-1.5 text-right font-mono text-xs font-medium">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 px-5 pt-5">
            <CardTitle className="text-sm font-semibold">
              Tariff &amp; Financing
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <table
              className="w-full text-sm"
              data-testid="table-financial-assumptions"
            >
              <tbody className="divide-y divide-border">
                {[
                  ["Grid tariff",     `EGP ${fmt(project.tariffValue, 3)}/kWh (${TARIFF_LABELS[project.tariffType] ?? project.tariffType})`],
                  ["Export tariff",   exportTariff > 0 ? `EGP ${fmt(exportTariff, 3)}/kWh` : "Not set"],
                  ["Self-consumed %", `${fmt(selfConsumptionRatio * 100, 0)}% on-site`],
                  ["Escalation",      ESCALATION_LABELS[project.escalationScenario] ?? project.escalationScenario],
                  ["Financing",       project.financingMode === "loan" ? "Bank loan (annuity)" : "Cash purchase"],
                  ...(project.financingMode === "loan" && loanParams ? [
                    ["Loan share",    `${fmt(loanParams.loanShare * 100, 0)}% of CAPEX`],
                    ["Interest rate", `${fmt(loanParams.interestRate * 100, 1)}% p.a.`],
                    ["Loan tenor",    `${loanParams.tenorYears} years`],
                    ["Annual debt svc.", `EGP ${fmt(engineResult.annualDebtService, 0)}`],
                  ] : []),
                  ["Analysis period", `${project.analysisPeriod} years`],
                  ["Discount rate",   `${((activeEpc?.discountRate ?? 0.11) * 100).toFixed(0)}%`],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-1.5 text-muted-foreground text-xs">{k}</td>
                    <td className="py-1.5 text-right font-mono text-xs font-medium truncate max-w-[180px]">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── PDF Download CTA ── */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-5 pb-5 flex flex-col sm:flex-row items-center gap-4 justify-between">
          <div>
            <div className="font-semibold text-sm">
              Ready to share with your client?
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Download the branded 4-page PDF — cover, cashflow chart, full cashflow table, and assumptions.
            </div>
          </div>
          <Button
            className="gap-2 shrink-0"
            onClick={handleDownloadPdf}
            style={{ backgroundColor: brandColor }}
            data-testid="button-download-pdf-bottom"
          >
            <Download className="w-4 h-4" />
            Download PDF
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
