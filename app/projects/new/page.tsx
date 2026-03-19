"use client";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useEpc } from "@/components/Providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronRight, Info } from "lucide-react";
import {
  DEFAULT_CAPEX_PER_KWP,
  DEFAULT_OM_PERCENT,
  DEFAULT_LOAN_SHARE,
  DEFAULT_INTEREST_RATE,
  DEFAULT_LOAN_TENOR,
  DEFAULT_TARIFFS,
  REGION_YIELDS,
} from "@/lib/constants";
import type { ProjectData } from "@/lib/types";

// ─── Form schema ──────────────────────────────────────────────────────────────
const schema = z
  .object({
    clientName: z.string().min(2, "Required"),
    siteName: z.string().min(2, "Required"),
    city: z.string().min(2, "Required"),
    systemSizeKwp: z
      .number({ invalid_type_error: "Enter a number" })
      .positive("Must be > 0"),
    capexPerKwp: z
      .number({ invalid_type_error: "Enter a number" })
      .positive("Must be > 0"),
    oAndMPercent: z
      .number({ invalid_type_error: "Enter a number" })
      .min(0)
      .max(10),
    region: z.enum(["north", "cairo_delta", "upper_egypt"]),
    tariffType: z.enum(["industrial_mv", "commercial_mv", "custom"]),
    customTariff: z
      .number({ invalid_type_error: "Enter a number" })
      .positive()
      .optional(),
    exportTariff: z
      .number({ invalid_type_error: "Enter a number" })
      .min(0)
      .default(0.0),
    escalationScenario: z.enum(["0", "7.5", "17.5"]),
    // Self-consumption
    consumptionKwh: z
      .number({ invalid_type_error: "Enter a number" })
      .min(0)
      .default(0),
    selfConsumptionRatio: z
      .number({ invalid_type_error: "Enter a number" })
      .min(0)
      .max(1)
      .default(0.8),
    financingMode: z.enum(["cash", "loan"]),
    loanShare: z.number().min(10).max(100).optional(),
    interestRate: z.number().min(1).max(50).optional(),
    tenorYears: z.number().int().min(1).max(25).optional(),
    analysisPeriod: z.number().int().min(10).max(40).default(25),
  })
  .superRefine((d, ctx) => {
    if (
      d.tariffType === "custom" &&
      (d.customTariff === undefined || d.customTariff <= 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["customTariff"],
        message: "Enter a custom tariff value",
      });
    }
    if (d.financingMode === "loan") {
      if (!d.loanShare)
        ctx.addIssue({
          code: "custom",
          path: ["loanShare"],
          message: "Required for loan mode",
        });
      if (!d.interestRate)
        ctx.addIssue({
          code: "custom",
          path: ["interestRate"],
          message: "Required for loan mode",
        });
      if (!d.tenorYears)
        ctx.addIssue({
          code: "custom",
          path: ["tenorYears"],
          message: "Required for loan mode",
        });
    }
  });

type FormData = z.infer<typeof schema>;

// ─── Field wrapper ────────────────────────────────────────────────────────────
function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionTitle({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-primary">{icon}</span>
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">
        {title}
      </h2>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function NewProjectPage() {
  const { activeEpcId, activeEpc } = useEpc();
  const router = useRouter();
  const { toast } = useToast();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      clientName: "",
      siteName: "",
      city: "",
      systemSizeKwp: 500,
      capexPerKwp: DEFAULT_CAPEX_PER_KWP,
      oAndMPercent: DEFAULT_OM_PERCENT,
      region: "cairo_delta",
      tariffType: "industrial_mv",
      exportTariff: 0.0,
      escalationScenario: "7.5",
      consumptionKwh: 0,
      selfConsumptionRatio: 0.8,
      financingMode: "cash",
      loanShare: DEFAULT_LOAN_SHARE * 100,
      interestRate: DEFAULT_INTEREST_RATE * 100,
      tenorYears: DEFAULT_LOAN_TENOR,
      analysisPeriod: 25,
    },
  });

  const {
    watch,
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = form;

  const tariffType = watch("tariffType");
  const financingMode = watch("financingMode");
  const region = watch("region");
  const systemKwp = watch("systemSizeKwp") ?? 0;
  const capex = watch("capexPerKwp") ?? 0;
  const consumptionKwh = watch("consumptionKwh") ?? 0;
  const selfConsumptionRatio = watch("selfConsumptionRatio") ?? 0.8;
  const totalCapex = systemKwp * capex;

  const yieldForRegion =
    region === "north" ? 1550 : region === "upper_egypt" ? 1800 : 1650;
  const estProduction = (systemKwp || 0) * yieldForRegion;
  const eligibleProd = consumptionKwh > 0 ? Math.min(estProduction, consumptionKwh) : estProduction;
  const estSelfConsumed = eligibleProd * selfConsumptionRatio;
  const estExported = estProduction - estSelfConsumed;

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const tariffValue =
        data.tariffType === "custom"
          ? data.customTariff!
          : DEFAULT_TARIFFS[data.tariffType];

      const payload: Record<string, unknown> = {
        epcId: activeEpcId,
        clientName: data.clientName,
        siteName: data.siteName,
        city: data.city,
        systemSizeKwp: data.systemSizeKwp,
        capexPerKwp: data.capexPerKwp,
        oAndMPercent: data.oAndMPercent,
        region: data.region,
        specificYield: REGION_YIELDS[data.region] ?? 1650,
        tariffType: data.tariffType,
        tariffValue,
        exportTariff: data.exportTariff ?? 0.0,
        escalationScenario: data.escalationScenario,
        consumptionKwh: data.consumptionKwh ?? 0,
        selfConsumptionRatio: data.selfConsumptionRatio ?? 0.8,
        financingMode: data.financingMode,
        analysisPeriod: data.analysisPeriod,
        discountRate: activeEpc?.discountRate ?? 0.11,
      };

      if (data.financingMode === "loan") {
        payload.financingParams = {
          loanShare: data.loanShare! / 100,
          interestRate: data.interestRate! / 100,
          tenorYears: data.tenorYears!,
        };
      }

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Server error");
      }
      return res.json() as Promise<{ project: ProjectData; result: unknown }>;
    },
    onSuccess: ({ project }) => {
      toast({ title: "Proposal created", description: "Calculating results…" });
      router.push(`/projects/${project.id}`);
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to create proposal.",
        variant: "destructive",
      });
    },
  });

  if (!activeEpcId) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">
          Please{" "}
          <a href="/setup" className="underline text-primary">
            set up your EPC profile
          </a>{" "}
          before creating proposals.
        </p>
      </div>
    );
  }

  const brandColor = activeEpc?.brandColor ?? "#0d6e74";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">New Solar Proposal</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Fill in project details to generate a branded PDF proposal with ROI
          metrics.
        </p>
      </div>

      <form
        onSubmit={handleSubmit((d) => mutation.mutate(d))}
        className="space-y-5"
      >
        {/* ── Client Information ── */}
        <Card>
          <CardContent className="pt-5">
            <SectionTitle icon="👤" title="Client Information" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field
                label="Client Company Name *"
                error={errors.clientName?.message}
              >
                <Input
                  placeholder="e.g. Cairo Textile Factory"
                  data-testid="input-client-name"
                  {...register("clientName")}
                />
              </Field>
              <Field label="Site Name *" error={errors.siteName?.message}>
                <Input
                  placeholder="e.g. Main Production Facility"
                  data-testid="input-site-name"
                  {...register("siteName")}
                />
              </Field>
              <Field
                label="City / Governorate *"
                error={errors.city?.message}
              >
                <Input
                  placeholder="e.g. 10th of Ramadan, Sharqia"
                  data-testid="input-city"
                  {...register("city")}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* ── System Design ── */}
        <Card>
          <CardContent className="pt-5">
            <SectionTitle icon="⚡" title="System Design" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field
                label="System Size (kWp) *"
                error={errors.systemSizeKwp?.message}
              >
                <Input
                  type="number"
                  step="10"
                  data-testid="input-system-size"
                  {...register("systemSizeKwp", { valueAsNumber: true })}
                />
              </Field>
              <Field
                label="CAPEX per kWp (EGP)"
                error={errors.capexPerKwp?.message}
                hint={`Total: EGP ${totalCapex.toLocaleString()}`}
              >
                <Input
                  type="number"
                  step="100"
                  data-testid="input-capex-per-kwp"
                  {...register("capexPerKwp", { valueAsNumber: true })}
                />
              </Field>
              <Field
                label="O&M (% of CAPEX / yr)"
                error={errors.oAndMPercent?.message}
                hint="Annual operations & maintenance"
              >
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  data-testid="input-om-percent"
                  {...register("oAndMPercent", { valueAsNumber: true })}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* ── Solar Resource Region ── */}
        <Card>
          <CardContent className="pt-5">
            <SectionTitle icon="☀️" title="Solar Resource Region" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Region" error={errors.region?.message}>
                <Controller
                  control={control}
                  name="region"
                  render={({ field }) => (
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <SelectTrigger data-testid="select-region">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="north">
                          North (Alexandria / North Coast) — 1,550 kWh/kWp
                        </SelectItem>
                        <SelectItem value="cairo_delta">
                          Cairo / Delta — 1,650 kWh/kWp
                        </SelectItem>
                        <SelectItem value="upper_egypt">
                          Upper Egypt / Aswan — 1,800 kWh/kWp
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <div className="bg-primary/5 rounded-lg p-3 border border-primary/10 flex flex-col justify-center">
                <div className="text-xs text-muted-foreground">
                  Est. annual production (Year 1)
                </div>
                <div className="text-lg font-mono font-semibold text-primary">
                  {estProduction.toLocaleString()} kWh/yr
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Tariff & Escalation ── */}
        <Card>
          <CardContent className="pt-5">
            <SectionTitle icon="📊" title="Tariff & Escalation" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Grid Purchase Tariff" error={errors.tariffType?.message}>
                <Controller
                  control={control}
                  name="tariffType"
                  render={({ field }) => (
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <SelectTrigger data-testid="select-tariff-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="industrial_mv">
                          Industrial MV (~2.00 EGP/kWh)
                        </SelectItem>
                        <SelectItem value="commercial_mv">
                          Commercial MV (~2.20 EGP/kWh)
                        </SelectItem>
                        <SelectItem value="custom">Custom tariff</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              {tariffType === "custom" && (
                <Field
                  label="Custom Grid Tariff (EGP/kWh)"
                  error={errors.customTariff?.message}
                >
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="e.g. 2.35"
                    data-testid="input-custom-tariff"
                    {...register("customTariff", { valueAsNumber: true })}
                  />
                </Field>
              )}

              <Field
                label="Export Tariff (EGP/kWh)"
                error={errors.exportTariff?.message}
                hint="Revenue for surplus sent to grid (0 if net-metering not available)"
              >
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 0.80"
                  data-testid="input-export-tariff"
                  {...register("exportTariff", { valueAsNumber: true })}
                />
              </Field>

              <Field
                label="Tariff Escalation"
                error={errors.escalationScenario?.message}
              >
                <Controller
                  control={control}
                  name="escalationScenario"
                  render={({ field }) => (
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <SelectTrigger data-testid="select-escalation">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">
                          0% per year (flat tariff)
                        </SelectItem>
                        <SelectItem value="7.5">
                          5–10% per year (use 7.5%)
                        </SelectItem>
                        <SelectItem value="17.5">
                          15–20% per year (use 17.5%)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* ── Self-Consumption ── */}
        <Card>
          <CardContent className="pt-5">
            <SectionTitle icon="🏭" title="Self-Consumption" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field
                label="Annual Site Consumption (kWh)"
                error={errors.consumptionKwh?.message}
                hint="Leave 0 if unknown — engine assumes unlimited consumption"
              >
                <Input
                  type="number"
                  step="1000"
                  min="0"
                  placeholder="e.g. 800000"
                  data-testid="input-consumption-kwh"
                  {...register("consumptionKwh", { valueAsNumber: true })}
                />
              </Field>
              <Field
                label="Self-Consumption Ratio"
                error={errors.selfConsumptionRatio?.message}
                hint="Fraction of eligible production consumed on-site (0–1)"
              >
                <Input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  placeholder="e.g. 0.80"
                  data-testid="input-self-consumption-ratio"
                  {...register("selfConsumptionRatio", { valueAsNumber: true })}
                />
              </Field>
            </div>
            {/* Live preview */}
            {estProduction > 0 && (
              <div className="mt-3 bg-primary/5 border border-primary/10 rounded-lg p-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-muted-foreground">Production (Y1)</div>
                  <div className="text-sm font-mono font-semibold text-primary">{estProduction.toLocaleString()} kWh</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Self-Consumed</div>
                  <div className="text-sm font-mono font-semibold text-green-600">{Math.round(estSelfConsumed).toLocaleString()} kWh</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Exported</div>
                  <div className="text-sm font-mono font-semibold text-blue-600">{Math.round(estExported).toLocaleString()} kWh</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Financing Mode ── */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-4">
              <SectionTitle icon="🏦" title="Financing Mode" />
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm text-muted-foreground">Cash</span>
                <Controller
                  control={control}
                  name="financingMode"
                  render={({ field }) => (
                    <Switch
                      checked={field.value === "loan"}
                      onCheckedChange={(v) =>
                        field.onChange(v ? "loan" : "cash")
                      }
                      data-testid="switch-financing-mode"
                    />
                  )}
                />
                <span className="text-sm text-muted-foreground">Bank Loan</span>
              </div>
            </div>

            {financingMode === "loan" ? (
              <div className="grid grid-cols-3 gap-4">
                <Field
                  label="Loan Share (% of CAPEX)"
                  error={errors.loanShare?.message}
                >
                  <Input
                    type="number"
                    step="5"
                    min="10"
                    max="100"
                    data-testid="input-loan-share"
                    {...register("loanShare", { valueAsNumber: true })}
                  />
                </Field>
                <Field
                  label="Interest Rate (% p.a.)"
                  error={errors.interestRate?.message}
                >
                  <Input
                    type="number"
                    step="0.5"
                    min="1"
                    max="50"
                    data-testid="input-interest-rate"
                    {...register("interestRate", { valueAsNumber: true })}
                  />
                </Field>
                <Field
                  label="Loan Tenor (years)"
                  error={errors.tenorYears?.message}
                >
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    max="25"
                    data-testid="input-tenor-years"
                    {...register("tenorYears", { valueAsNumber: true })}
                  />
                </Field>
              </div>
            ) : (
              <div className="bg-muted/40 rounded-lg p-3 text-sm text-muted-foreground">
                Cash purchase — full CAPEX paid upfront. Cashflow = avoided grid
                cost + export revenue – O&amp;M.
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Analysis Settings ── */}
        <Card>
          <CardContent className="pt-5">
            <SectionTitle icon="📅" title="Analysis Settings" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Field
                label="Analysis Period (years)"
                error={errors.analysisPeriod?.message}
              >
                <Input
                  type="number"
                  step="1"
                  min="10"
                  max="40"
                  data-testid="input-analysis-period"
                  {...register("analysisPeriod", { valueAsNumber: true })}
                />
              </Field>
              <div className="col-span-3 flex items-end pb-0.5">
                <p className="text-xs text-muted-foreground">
                  Discount rate:{" "}
                  <strong>
                    {((activeEpc?.discountRate ?? 0.11) * 100).toFixed(0)}%
                  </strong>{" "}
                  (set in EPC profile) · Panel degradation: 0.5%/yr applied automatically
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Submit ── */}
        <Button
          type="submit"
          disabled={mutation.isPending}
          className="w-full gap-2 h-11 text-base font-semibold"
          style={{ backgroundColor: brandColor }}
          data-testid="button-calculate"
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Calculating…
            </>
          ) : (
            <>
              Calculate ROI & Generate Proposal{" "}
              <ChevronRight className="w-4 h-4" />
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
