import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { prisma } from "@/lib/prisma";
import { runFinancialEngine } from "@/lib/financialEngine";
import { ESCALATION_PRESETS, REGION_LABELS, TARIFF_LABELS, ESCALATION_LABELS } from "@/lib/constants";
import type { LoanParams } from "@/lib/financialEngine";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

export const dynamic = "force-dynamic";

// ── Font paths (served from public/fonts, copied to node_modules at build) ────
// In Next.js serverless, process.cwd() points to the project root.
const FONT_REGULAR = path.join(process.cwd(), "public", "fonts", "Amiri-Regular.ttf");
const FONT_BOLD    = path.join(process.cwd(), "public", "fonts", "Amiri-Bold.ttf");

// ── Colour helpers ─────────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function rgbToHex(rgb: [number,number,number]): string {
  return "#" + rgb.map(c => c.toString(16).padStart(2, "0")).join("");
}
function lightenHex(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  const lit = rgb.map(c => Math.round(c + (255 - c) * amount)) as [number,number,number];
  return rgbToHex(lit);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id: Number(id) } });
  if (!project) return NextResponse.json({ message: "Not found" }, { status: 404 });
  const epc = await prisma.epc.findUnique({ where: { id: project.epcId } });
  if (!epc)  return NextResponse.json({ message: "EPC not found" }, { status: 404 });

  const loanParams: LoanParams | undefined =
    project.financingMode === "loan" && project.financingParams
      ? JSON.parse(project.financingParams) : undefined;

  const result = runFinancialEngine({
    systemSizeKwp:        project.systemSizeKwp,
    region:               project.region,
    capexPerKwp:          project.capexPerKwp,
    oAndMPercent:         project.oAndMPercent,
    tariffValue:          project.tariffValue,
    escalationRate:       ESCALATION_PRESETS[project.escalationScenario] ?? 0,
    financingMode:        project.financingMode as "cash" | "loan",
    loanParams,
    analysisPeriod:       project.analysisPeriod,
    discountRate:         epc.discountRate,
    consumptionKwh:       project.consumptionKwh ?? 0,
    selfConsumptionRatio: project.selfConsumptionRatio ?? 0.8,
    exportTariff:         project.exportTariff ?? 0,
  });

  const today    = new Date();
  const dateStr  = today.toISOString().split("T")[0].replace(/-/g, "");
  const epcSlug  = epc.name.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");
  const cliSlug  = project.clientName.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");
  const filename = `${epcSlug}_${cliSlug}_SolarProposal_${dateStr}.pdf`;

  const brandHex  = epc.brandColor ?? "#0d6e74";
  const brand      = hexToRgb(brandHex);   // [r,g,b] — only used where PDFKit accepts arrays
  const brandL     = lightenHex(brandHex, 0.88);  // hex string — safe everywhere
  const brandL35   = lightenHex(brandHex, 0.35);
  const brandL60   = lightenHex(brandHex, 0.60);

  const fmt = (n: number, dec = 0) =>
    new Intl.NumberFormat("en-EG", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);

  // Derived energy numbers
  const scRatio      = project.selfConsumptionRatio ?? 0.8;
  const conKwh       = project.consumptionKwh ?? 0;
  const prodY1       = result.annualProductionY1;
  const selfConsumed = result.selfConsumedKwhY1;
  const exported     = result.exportedKwhY1;
  const gridAvoided  = selfConsumed;  // kWh saved from grid
  const annualSavings = selfConsumed * project.tariffValue + exported * (project.exportTariff ?? 0);

  // ── Build PDF ─────────────────────────────────────────────────────────────
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ margin: 0, size: "A4" });

  // Register Arabic font
  let arabicAvailable = false;
  try {
    doc.registerFont("Amiri",     FONT_REGULAR);
    doc.registerFont("Amiri-Bold", FONT_BOLD);
    arabicAvailable = true;
  } catch { /* font not found — skip Arabic sections */ }

  await new Promise<void>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", resolve);
    doc.on("error", reject);

    const PW = 595;  // A4 width
    const PH = 842;  // A4 height
    const ML = 48;   // left margin
    const MR = 48;   // right margin
    const CW = PW - ML - MR;  // content width = 499

    // ── Helper: section header (slash bar style like SMA) ────────────────
    const sectionHeader = (text: string, y: number) => {
      doc.rect(ML, y, 3, 16).fill(brand);
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#111111").text(text, ML + 10, y + 1);
      return y + 28;
    };

    // ── Helper: standard page footer ─────────────────────────────────────
    const drawFooter = (pageNum: number, totalPages: number) => {
      doc.rect(ML, PH - 38, CW, 1).fill(brand);
      const footParts: string[] = [epc.name];
      if ((epc as any).phone) footParts.push((epc as any).phone);
      footParts.push(epc.email);
      doc.font("Helvetica").fontSize(8).fillColor("#888888")
        .text(footParts.join("  ·  "), ML, PH - 28, { width: CW - 60, align: "left" });
      doc.font("Helvetica").fontSize(8).fillColor("#888888")
        .text(`${pageNum} / ${totalPages}`, ML, PH - 28, { width: CW, align: "right" });
    };

    const TOTAL_PAGES = 6;

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 1 — COVER
    // ════════════════════════════════════════════════════════════════════════

    // Bold colour block — top 38% of page
    const coverBlockH = Math.round(PH * 0.38);
    doc.rect(0, 0, PW, coverBlockH).fill(brand);

    // EPC Logo top-right corner
    if (epc.logoUrl && epc.logoUrl.startsWith("data:image")) {
      try {
        const [, b64] = epc.logoUrl.split(",");
        const imgBuf  = Buffer.from(b64, "base64");
        doc.image(imgBuf, PW - ML - 110, 24, { height: 48, fit: [110, 48] });
      } catch { /* skip */ }
    }

    // EPC name + contact in white on color block
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff")
      .text(epc.name, ML, 30);
    const epcSub: string[] = [epc.email];
    if ((epc as any).phone) epcSub.push((epc as any).phone);
    doc.font("Helvetica").fontSize(9).fillColor("rgba(255,255,255,0.80)")
      .text(epcSub.join("  ·  "), ML, 48);

    // Project title
    const projTitle = (project as any).projectName
      || `Solar Proposal — ${project.clientName}`;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("rgba(255,255,255,0.65)")
      .text("SOLAR INVESTMENT PROPOSAL", ML, coverBlockH - 130);
    doc.font("Helvetica-Bold").fontSize(24).fillColor("#ffffff")
      .text(projTitle, ML, coverBlockH - 110, { width: CW - 30, lineGap: 4 });

    // White section below colour block
    // Client / site / date block
    const cvY = coverBlockH + 28;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#333333").text("Prepared for:", ML, cvY);
    doc.font("Helvetica").fontSize(10).fillColor("#111111").text(project.clientName, ML + 90, cvY);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#333333").text("Site:", ML, cvY + 16);
    doc.font("Helvetica").fontSize(10).fillColor("#111111")
      .text(`${project.siteName}${(project as any).siteAddress ? " — " + (project as any).siteAddress : ""}, ${project.city}`, ML + 90, cvY + 16, { width: CW - 90 });
    if ((project as any).gpsCoords) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#333333").text("GPS:", ML, cvY + 32);
      doc.font("Helvetica").fontSize(10).fillColor("#111111").text((project as any).gpsCoords, ML + 90, cvY + 32);
    }
    const dateY = (project as any).gpsCoords ? cvY + 48 : cvY + 32;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#333333").text("Date:", ML, dateY);
    doc.font("Helvetica").fontSize(10).fillColor("#111111")
      .text(today.toLocaleDateString("en-EG", { year: "numeric", month: "long", day: "numeric" }), ML + 90, dateY);

    // Divider
    const divY = dateY + 22;
    doc.rect(ML, divY, CW, 1).fill("#eeeeee");

    // Bilingual rationale box
    const ratY = divY + 16;
    doc.rect(ML, ratY, CW, 78).fillAndStroke(brandL, brandL60);
    const noteEN = (project as any).projectNote
      || `This proposal presents the financial and environmental case for a ${fmt(project.systemSizeKwp, 1)} kWp solar installation at ${project.siteName}, ${project.city}, delivering significant electricity cost savings and a strong return on investment over a ${project.analysisPeriod}-year analysis period.`;
    doc.font("Helvetica").fontSize(9.5).fillColor("#1a5c60")
      .text(noteEN, ML + 10, ratY + 8, { width: CW - 20 });

    // Arabic rationale (rendered with Amiri if available)
    const arText = `يُقدِّم هذا المقترح الجدوى المالية والبيئية لتركيب منظومة طاقة شمسية بقدرة ${fmt(project.systemSizeKwp, 1)} ك.و.ذ في ${project.siteName}، ${project.city}، مع توفير ملحوظ في تكاليف الكهرباء وعائد استثمار مجزٍ على مدى ${project.analysisPeriod} عامًا.`;
    if (arabicAvailable) {
      doc.font("Amiri").fontSize(9).fillColor("#555555")
        .text(arText, ML + 10, ratY + 46, { width: CW - 20, features: ["rtla"] });
    } else {
      doc.font("Helvetica").fontSize(8).fillColor("#888888")
        .text("[Arabic version available when Amiri font is loaded]", ML + 10, ratY + 46, { width: CW - 20 });
    }

    drawFooter(1, TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 2 — PROJECT AT A GLANCE
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "A4" });

    // Header bar
    doc.rect(0, 0, PW, 48).fill(brand);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff").text("Project at a Glance", ML, 16);

    let y2 = 68;

    // ── KPI icon strip (4 boxes) ──────────────────────────────────────────
    const kpiItems = [
      { label: "System Size",       value: `${fmt(project.systemSizeKwp, 1)} kWp`,     icon: "☀" },
      { label: "Simple Payback",    value: result.simplePayback !== null ? `${fmt(result.simplePayback, 1)} yrs` : "N/A", icon: "⏱" },
      { label: "Annual Savings Y1", value: `EGP ${fmt(annualSavings/1000, 1)}K`,         icon: "💰" },
      { label: `CO₂ Avoided`,       value: `${fmt(result.co2SavedTonnes, 0)} t`,          icon: "🌱" },
    ];
    const kpiW = (CW - 12) / 4;
    kpiItems.forEach((k, i) => {
      const kx = ML + i * (kpiW + 4);
      doc.rect(kx, y2, kpiW, 70).fillAndStroke(brandL, brandL60);
      doc.font("Helvetica").fontSize(22).fillColor(brandHex).text(k.icon, kx, y2 + 8, { width: kpiW, align: "center" });
      doc.font("Helvetica-Bold").fontSize(13).fillColor(brandHex).text(k.value, kx, y2 + 33, { width: kpiW, align: "center" });
      doc.font("Helvetica").fontSize(8).fillColor("#666666").text(k.label, kx, y2 + 52, { width: kpiW, align: "center" });
    });
    y2 += 86;

    // ── Executive summary bullets ─────────────────────────────────────────
    y2 = sectionHeader("Executive Summary", y2);
    const summaryBullets = [
      `System: ${fmt(project.systemSizeKwp,1)} kWp installed at ${project.siteName}, ${project.city} (${REGION_LABELS[project.region] ?? project.region})`,
      `Annual production (Year 1): ${fmt(prodY1,0)} kWh · Average over ${project.analysisPeriod} years: ${fmt(result.annualProductionAvg,0)} kWh`,
      `Self-consumed: ${fmt(selfConsumed,0)} kWh (${fmt(scRatio*100,0)}% ratio) · Exported: ${fmt(exported,0)} kWh`,
      conKwh > 0 ? `Site consumption: ${fmt(conKwh,0)} kWh/yr · Solar covers ${fmt(Math.min((selfConsumed/conKwh)*100,100),0)}% of site demand` : `Consumption not specified — assuming unlimited self-consumption eligibility`,
      `Simple payback: ${result.simplePayback !== null ? fmt(result.simplePayback,1)+" years" : "beyond analysis period"} · IRR: ${result.irr !== null ? fmt(result.irr*100,1)+"%" : "N/A"}`,
      `${project.analysisPeriod}-year NPV at ${fmt(epc.discountRate*100,0)}% discount rate: EGP ${fmt(result.npv,0)}`,
      `CO₂ avoided over ${project.analysisPeriod} years: ${fmt(result.co2SavedTonnes,0)} tonnes`,
    ];
    doc.font("Helvetica").fontSize(9.5).fillColor("#222222");
    summaryBullets.forEach(b => {
      doc.rect(ML, y2 - 1, 3, 12).fill(brand);
      doc.text(b, ML + 8, y2, { width: CW - 8 });
      y2 += 18;
    });
    y2 += 6;

    // ── System overview BOM box ────────────────────────────────────────────
    y2 = sectionHeader("System Overview", y2 + 4);
    const bomRows: [string, string][] = [
      ["PV System",         `${fmt(project.systemSizeKwp,1)} kWp · ${REGION_LABELS[project.region] ?? project.region}`],
      ["Solar Modules",     (project as any).moduleModel   || "Not specified"],
      ["Inverter",          (project as any).inverterModel || "Not specified"],
      ["Battery Storage",   (project as any).storageModel
        ? `${(project as any).storageModel}${(project as any).storageCapacityKwh ? " — "+fmt((project as any).storageCapacityKwh,0)+" kWh" : ""}`
        : "None"],
      ["Total Investment",  `EGP ${fmt(result.totalCapex,0)} (EGP ${fmt(project.capexPerKwp,0)}/kWp)`],
      ["Financing",         project.financingMode === "loan" ? `Bank Loan${loanParams ? ` — ${fmt(loanParams.loanShare*100,0)}% of CAPEX @ ${fmt(loanParams.interestRate*100,1)}% for ${loanParams.tenorYears} yrs` : ""}` : "Cash Purchase"],
    ];
    bomRows.forEach(([k, v], i) => {
      if (i % 2 === 0) doc.rect(ML, y2 - 1, CW, 16).fill("#f7f7f6");
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#444444").text(k, ML + 6, y2, { width: 140 });
      doc.font("Helvetica").fontSize(9).fillColor("#111111").text(v, ML + 152, y2, { width: CW - 158 });
      y2 += 16;
    });

    drawFooter(2, TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 3 — ENERGY FLOW & SAVINGS
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "A4" });
    doc.rect(0, 0, PW, 48).fill(brand);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff").text("Energy Flow & Savings", ML, 16);

    let y3 = 68;
    y3 = sectionHeader("Annual Energy Balance (Year 1)", y3);

    // ── Horizontal stacked-style energy flow chart ────────────────────────
    // Draw as a segmented horizontal bar + value boxes below
    const chartX = ML;
    const chartY = y3;
    const chartW = CW;
    const chartH = 44;

    // Values
    const totalForChart = Math.max(prodY1, conKwh || prodY1);
    const barProdW  = Math.round((prodY1 / totalForChart) * chartW);
    const barScW    = Math.round((selfConsumed / prodY1) * barProdW);
    const barExpW   = barProdW - barScW;

    // Production bar (background)
    doc.rect(chartX, chartY, barProdW, chartH).fill(brand);
    // Self-consumed segment (lighter)
    doc.rect(chartX, chartY, barScW, chartH).fill(brand);
    // Exported segment (tinted)
    doc.rect(chartX + barScW, chartY, barExpW, chartH).fill(brandL35);

    // If consumption given, show remaining grid dependency
    if (conKwh > 0 && conKwh > selfConsumed) {
      const gridKwh = conKwh - selfConsumed;
      const gridBarX = chartX + barProdW + 4;
      const gridBarW = Math.min(Math.round((gridKwh / totalForChart) * chartW), chartW - barProdW - 4);
      if (gridBarW > 0) {
        doc.rect(gridBarX, chartY, gridBarW, chartH).fill("#cccccc");
        doc.font("Helvetica").fontSize(7.5).fillColor("#666666")
          .text(`Grid: ${fmt(gridKwh/1000,1)} MWh`, gridBarX + 4, chartY + 15, { width: gridBarW - 4 });
      }
    }

    // Labels inside bars
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff")
      .text(`Self-consumed\n${fmt(selfConsumed/1000,1)} MWh`, chartX + 6, chartY + 6, { width: Math.max(barScW - 8, 50) });
    if (barExpW > 40) {
      doc.font("Helvetica").fontSize(8.5).fillColor("#ffffff")
        .text(`Export\n${fmt(exported/1000,1)} MWh`, chartX + barScW + 4, chartY + 6, { width: barExpW - 6 });
    }

    y3 = chartY + chartH + 10;

    // Legend
    doc.rect(ML, y3, 10, 10).fill(brand);
    doc.font("Helvetica").fontSize(8).fillColor("#444444").text("Self-consumed", ML + 13, y3 + 1);
    doc.rect(ML + 100, y3, 10, 10).fill(brandL35);
    doc.font("Helvetica").fontSize(8).fillColor("#444444").text("Exported to grid", ML + 113, y3 + 1);
    if (conKwh > 0) {
      doc.rect(ML + 220, y3, 10, 10).fill("#cccccc");
      doc.font("Helvetica").fontSize(8).fillColor("#444444").text("Remaining from grid", ML + 233, y3 + 1);
    }
    y3 += 20;

    // ── Four KPI boxes: energy split ─────────────────────────────────────
    const eBoxW = (CW - 9) / 4;
    const energyKpis = [
      { label: "Total Production",   value: `${fmt(prodY1/1000,1)} MWh`,     sub: "Year 1 output" },
      { label: "Self-Consumed",      value: `${fmt(selfConsumed/1000,1)} MWh`, sub: `${fmt(scRatio*100,0)}% of production` },
      { label: "Exported",           value: `${fmt(exported/1000,1)} MWh`,    sub: conKwh > 0 ? `${fmt((exported/prodY1)*100,0)}% of production` : "surplus to grid" },
      { label: "Grid Avoided",       value: `${fmt(gridAvoided/1000,1)} MWh`, sub: "kWh not purchased" },
    ];
    energyKpis.forEach((k, i) => {
      const ex = ML + i * (eBoxW + 3);
      doc.rect(ex, y3, eBoxW, 52).fillAndStroke(i % 2 === 0 ? "#f7f7f6" : brandL, "#eeeeee");
      doc.font("Helvetica-Bold").fontSize(14).fillColor(brandHex).text(k.value, ex, y3 + 8, { width: eBoxW, align: "center" });
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#444444").text(k.label, ex, y3 + 28, { width: eBoxW, align: "center" });
      doc.font("Helvetica").fontSize(7.5).fillColor("#888888").text(k.sub, ex, y3 + 39, { width: eBoxW, align: "center" });
    });
    y3 += 68;

    // ── Plain-language savings block ──────────────────────────────────────
    y3 = sectionHeader("How Your Investment Pays Off", y3);

    const gridSavings   = selfConsumed * project.tariffValue;
    const exportRevenue = exported * (project.exportTariff ?? 0);
    const totalAnnual   = gridSavings + exportRevenue;

    const savingsLines = [
      `The ${fmt(project.systemSizeKwp,1)} kWp solar system produces an estimated ${fmt(prodY1,0)} kWh in Year 1.`,
      `Of this, ${fmt(selfConsumed,0)} kWh (${fmt(scRatio*100,0)}%) is consumed directly on-site, avoiding grid purchases at EGP ${fmt(project.tariffValue,3)}/kWh.`,
      conKwh > 0 ? `The solar system covers approximately ${fmt(Math.min((selfConsumed/conKwh)*100,100),0)}% of the site's total electricity needs.` : null,
      exportRevenue > 0 ? `An additional ${fmt(exported,0)} kWh is exported to the grid, earning EGP ${fmt(project.exportTariff!,3)}/kWh in feed-in revenue.` : null,
      `Total Year 1 financial benefit: EGP ${fmt(gridSavings,0)} in avoided costs${exportRevenue > 0 ? ` + EGP ${fmt(exportRevenue,0)} export revenue = EGP ${fmt(totalAnnual,0)}` : ""}.`,
      `Over ${project.analysisPeriod} years (including tariff escalation & panel degradation), the cumulative cashflow reaches EGP ${fmt(result.cumulativeCashflows[result.cumulativeCashflows.length-1],0)}.`,
    ].filter(Boolean) as string[];

    doc.rect(ML, y3 - 4, CW, savingsLines.length * 19 + 16).fillAndStroke("#f0f9f9", brandL60);
    savingsLines.forEach((line, i) => {
      doc.font(i === savingsLines.length - 1 ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor("#1a5c60")
        .text(line, ML + 10, y3 + 4 + i * 19, { width: CW - 20 });
    });
    y3 += savingsLines.length * 19 + 24;

    // Arabic savings summary
    if (arabicAvailable) {
      const arSavings = `يُنتج هذا النظام ${fmt(prodY1,0)} ك.و.س سنويًا، يُستهلك منها ${fmt(selfConsumed,0)} ك.و.س ذاتيًا مما يُوفِّر EGP ${fmt(gridSavings,0)} في السنة الأولى${exportRevenue > 0 ? `، بالإضافة إلى EGP ${fmt(exportRevenue,0)} من عائد التغذية العكسية` : ""}. ويُتوقَّع أن يُحقِّق المشروع العائد على الاستثمار خلال ${result.simplePayback !== null ? fmt(result.simplePayback,1) : "N/A"} سنوات.`;
      doc.rect(ML, y3 - 2, CW, 36).fill(brandL);  // brandL is now hex string — OK
      doc.font("Amiri").fontSize(10).fillColor("#1a5c60")
        .text(arSavings, ML + 10, y3 + 4, { width: CW - 20, features: ["rtla"] });
      y3 += 42;
    }

    drawFooter(3, TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 4 — FINANCIAL RESULTS (KPIs + Cashflow Chart)
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "A4" });
    doc.rect(0, 0, PW, 48).fill(brand);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff").text("Financial Results", ML, 16);

    let y4 = 68;

    // ── Three KPI tiles ───────────────────────────────────────────────────
    const finKpis = [
      { label: "Simple Payback", value: result.simplePayback !== null ? `${fmt(result.simplePayback,1)} yrs` : "N/A" },
      { label: `NPV (${project.analysisPeriod} yr)`, value: `EGP ${fmt(result.npv/1e6, 2)}M` },
      { label: "IRR", value: result.irr !== null ? `${fmt(result.irr*100,1)}%` : "N/A" },
    ];
    const fkW = (CW - 8) / 3;
    finKpis.forEach((k, i) => {
      const fx = ML + i * (fkW + 4);
      doc.rect(fx, y4, fkW, 60).fill(brand);
      doc.font("Helvetica-Bold").fontSize(20).fillColor("#ffffff").text(k.value, fx, y4 + 10, { width: fkW, align: "center" });
      doc.font("Helvetica").fontSize(9).fillColor("rgba(255,255,255,0.80)").text(k.label, fx, y4 + 38, { width: fkW, align: "center" });
    });
    y4 += 74;

    // ── Cashflow chart ────────────────────────────────────────────────────
    y4 = sectionHeader("Annual & Cumulative Cashflow", y4 + 4);

    const chartX4 = ML + 30;  // leave room for Y-axis labels
    const chartW4 = CW - 30;
    const chartH4 = 200;
    const n4      = result.annualCashflows.length;

    doc.rect(chartX4, y4, chartW4, chartH4).fillAndStroke("#fafafa", "#e5e5e5");

    const allVals = [...result.annualCashflows, ...result.cumulativeCashflows];
    const maxVal  = Math.max(...allVals, 0);
    const minVal  = Math.min(...allVals, 0);
    const range   = maxVal - minVal || 1;
    const zeroY4  = y4 + chartH4 * (maxVal / range);

    // Zero line
    doc.moveTo(chartX4, zeroY4).lineTo(chartX4 + chartW4, zeroY4).stroke("#cccccc");
    doc.font("Helvetica").fontSize(7).fillColor("#aaaaaa").text("0", ML, zeroY4 - 4, { width: 28, align: "right" });

    // Y-axis labels
    [maxVal, maxVal/2, minVal/2, minVal].filter(v => Math.abs(v) > 1).forEach(v => {
      const ly = y4 + chartH4 * ((maxVal - v) / range);
      doc.font("Helvetica").fontSize(7).fillColor("#aaaaaa")
        .text(`${fmt(v/1e6,1)}M`, ML, ly - 4, { width: 28, align: "right" });
    });

    const stepX4  = chartW4 / n4;
    const barW4   = Math.max(3, stepX4 * 0.55);
    const barPad4 = stepX4 * 0.225;

    result.annualCashflows.forEach((cf, i) => {
      const bx  = chartX4 + i * stepX4 + barPad4;
      const bh  = Math.abs(cf) / range * chartH4;
      const by  = cf >= 0 ? zeroY4 - bh : zeroY4;
      const col: [number,number,number] = cf >= 0 ? brand : [192,57,43];
      doc.rect(bx, by, barW4, bh).fill(col);
    });

    // Cumulative line
    doc.save();
    doc.rect(chartX4, y4, chartW4, chartH4).clip();
    let started = false;
    result.cumulativeCashflows.forEach((cum, i) => {
      const px = chartX4 + i * stepX4 + stepX4 / 2;
      const py = y4 + chartH4 * ((maxVal - cum) / range);
      if (!started) { doc.moveTo(px, py); started = true; } else { doc.lineTo(px, py); }
    });
    doc.lineWidth(2);
    doc.stroke("#f39c12");
    doc.lineWidth(1);
    doc.restore();

    // Payback marker
    if (result.simplePayback !== null && result.simplePayback <= n4) {
      const pbX = chartX4 + (result.simplePayback - 0.5) * stepX4 + stepX4 / 2;
      const pbXc = Math.max(chartX4, Math.min(pbX, chartX4 + chartW4 - 2));
      doc.save();
      doc.rect(chartX4, y4, chartW4, chartH4).clip();
      for (let dy = y4; dy < y4 + chartH4; dy += 7) {
        doc.moveTo(pbXc, dy).lineTo(pbXc, dy + 4);
        doc.lineWidth(1.5);
        doc.stroke("#27ae60");
      }
      doc.lineWidth(1);
      doc.restore();
      const lblX = Math.min(pbXc + 3, chartX4 + chartW4 - 60);
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#27ae60")
        .text(`✓ Payback yr ${fmt(result.simplePayback,1)}`, lblX, y4 + 4, { width: 60 });
    }

    // X-axis labels (every 5 years)
    for (let i = 0; i < n4; i += 5) {
      const lx = chartX4 + i * stepX4 + stepX4 / 2 - 10;
      doc.font("Helvetica").fontSize(7).fillColor("#888888").text(`Yr ${i+1}`, lx, y4 + chartH4 + 3, { width: 20, align: "center" });
    }

    // Legend
    const legY = y4 + chartH4 + 16;
    doc.rect(chartX4, legY, 10, 9).fill(brand);
    doc.font("Helvetica").fontSize(7.5).fillColor("#555").text("Annual CF", chartX4 + 13, legY + 1);
    doc.moveTo(chartX4 + 75, legY + 4).lineTo(chartX4 + 88, legY + 4);
    doc.lineWidth(2);
    doc.stroke("#f39c12");
    doc.lineWidth(1);
    doc.font("Helvetica").fontSize(7.5).fillColor("#555").text("Cumulative CF", chartX4 + 92, legY + 1);
    if (result.simplePayback !== null) {
      doc.rect(chartX4 + 180, legY + 3, 12, 2).fill("#27ae60");
      doc.font("Helvetica").fontSize(7.5).fillColor("#555").text("Payback year", chartX4 + 195, legY + 1);
    }

    drawFooter(4, TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 5 — FULL ANNUAL CASHFLOW TABLE
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "A4" });
    doc.rect(0, 0, PW, 48).fill(brand);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff").text("Annual Cashflow Detail", ML, 16);

    let y5 = 62;
    const cols5   = [ML, ML+52, ML+172, ML+292, ML+372, ML+442];
    const colW5   = [48, 115, 115, 75, 65, 55];
    const headers5 = ["Year", "Annual CF (EGP)", "Cumulative CF (EGP)", "Payback?", "Prod.(MWh)", "O&M"];

    const drawTableHeader = (y: number) => {
      doc.rect(ML, y, CW, 16).fill(brandL);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(brandHex);
      headers5.forEach((h, i) => doc.text(h, cols5[i], y + 4, { width: colW5[i] }));
      return y + 18;
    };

    y5 = drawTableHeader(y5);
    const rowH5    = 14;
    const maxRows5 = 43;
    let rowCount   = 0;

    for (let t = 0; t < result.annualCashflows.length; t++) {
      if (rowCount >= maxRows5) {
        drawFooter(5, TOTAL_PAGES);
        doc.addPage({ margin: 0, size: "A4" });
        doc.rect(0, 0, PW, 48).fill(brand);
        doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff").text("Annual Cashflow Detail (cont.)", ML, 16);
        y5 = 62;
        y5 = drawTableHeader(y5);
        rowCount = 0;
      }
      const cf  = result.annualCashflows[t];
      const cum = result.cumulativeCashflows[t];
      const prodThisYear = result.annualProductionY1 * Math.pow(0.995, t);
      const omThis = result.totalCapex * project.oAndMPercent / 100;
      const isP = result.simplePayback !== null && t >= Math.floor(result.simplePayback) && t < Math.floor(result.simplePayback)+1;

      if (t % 2 === 0) doc.rect(ML, y5, CW, rowH5).fill("#fafaf8");
      doc.font("Helvetica").fontSize(8.5);
      doc.fillColor(cf < 0 ? "#c0392b" : "#222").text(`${t+1}`, cols5[0], y5 + 2, { width: colW5[0] });
      doc.fillColor(cf < 0 ? "#c0392b" : "#222").text(fmt(cf,0), cols5[1], y5 + 2, { width: colW5[1] });
      doc.fillColor(cum < 0 ? "#c0392b" : "#27ae60").text(fmt(cum,0), cols5[2], y5 + 2, { width: colW5[2] });
      doc.fillColor(isP ? brand : "#aaa").text(isP ? "✓ Payback" : "—", cols5[3], y5 + 2, { width: colW5[3] });
      doc.fillColor("#555").text(fmt(prodThisYear/1000,1), cols5[4], y5 + 2, { width: colW5[4] });
      doc.fillColor("#555").text(fmt(omThis/1000,0)+"K", cols5[5], y5 + 2, { width: colW5[5] });

      y5 += rowH5;
      rowCount++;
    }

    drawFooter(5, TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 6 — ASSUMPTIONS & DISCLAIMER
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "A4" });
    doc.rect(0, 0, PW, 48).fill(brand);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff").text("Assumptions & Technical Data", ML, 16);

    let y6 = 68;
    y6 = sectionHeader("Key Assumptions", y6);

    const assumps: [string, string][] = [
      ["System size",          `${fmt(project.systemSizeKwp,1)} kWp`],
      ["Total CAPEX",          `EGP ${fmt(result.totalCapex,0)} (EGP ${fmt(project.capexPerKwp,0)}/kWp)`],
      ["Annual O&M",           `${project.oAndMPercent}% of CAPEX — EGP ${fmt(result.totalCapex*project.oAndMPercent/100,0)}/yr`],
      ["Region / yield",       `${REGION_LABELS[project.region] ?? project.region} — ${fmt(project.specificYield,0)} kWh/kWp/yr`],
      ["Annual production Y1", `${fmt(prodY1,0)} kWh · Avg: ${fmt(result.annualProductionAvg,0)} kWh/yr`],
      ["Panel degradation",    "0.5% per year (compound, applied in all cashflow years)"],
      ["Site consumption",     conKwh > 0 ? `${fmt(conKwh,0)} kWh/yr` : "Not specified"],
      ["Self-consumption ratio",`${fmt(scRatio*100,0)}%`],
      ["Grid purchase tariff", `EGP ${fmt(project.tariffValue,3)}/kWh (${TARIFF_LABELS[project.tariffType] ?? project.tariffType})`],
      ["Export tariff",        (project.exportTariff ?? 0) > 0 ? `EGP ${fmt(project.exportTariff!,3)}/kWh` : "Not applicable"],
      ["Tariff escalation",    ESCALATION_LABELS[project.escalationScenario] ?? project.escalationScenario],
      ["Financing mode",       project.financingMode === "loan" ? "Bank loan (annuity)" : "Cash purchase"],
      ...(loanParams ? [
        ["Loan share",          `${fmt(loanParams.loanShare*100,0)}% of CAPEX`] as [string,string],
        ["Interest rate",       `${fmt(loanParams.interestRate*100,1)}% p.a.`] as [string,string],
        ["Loan tenor",          `${loanParams.tenorYears} years`] as [string,string],
        ["Annual debt service", `EGP ${fmt(result.annualDebtService,0)}`] as [string,string],
      ] : []),
      ["Analysis period",      `${project.analysisPeriod} years`],
      ["Discount rate (NPV)",  `${fmt(epc.discountRate*100,1)}%`],
      ["CO₂ factor",           "0.45 kg CO₂/kWh (Egypt grid average)"],
      ["CO₂ avoided",          `${fmt(result.co2SavedTonnes,0)} tonnes over ${project.analysisPeriod} years`],
      ...(((project as any).gpsCoords) ? [["GPS coordinates", (project as any).gpsCoords] as [string,string]] : []),
    ];

    assumps.forEach(([k, v], i) => {
      if (i % 2 === 0) doc.rect(ML, y6 - 1, CW, 16).fill("#f7f7f6");
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#444444").text(k, ML + 6, y6, { width: 195 });
      doc.font("Helvetica").fontSize(9).fillColor("#111111").text(v, ML + 205, y6, { width: CW - 210 });
      y6 += 16;
    });

    y6 += 12;
    // Optional BOM section
    const hasBom = (project as any).moduleModel || (project as any).inverterModel || (project as any).storageModel;
    if (hasBom) {
      y6 = sectionHeader("Equipment Summary", y6);
      const bomFull: [string,string][] = [
        ...(((project as any).moduleModel)   ? [["Solar Modules",    (project as any).moduleModel]   as [string,string]] : []),
        ...(((project as any).inverterModel) ? [["Inverter(s)",      (project as any).inverterModel] as [string,string]] : []),
        ...(((project as any).storageModel)  ? [["Battery Storage",  `${(project as any).storageModel}${(project as any).storageCapacityKwh ? " — "+fmt((project as any).storageCapacityKwh,0)+" kWh" : ""}`] as [string,string]] : []),
      ];
      bomFull.forEach(([k, v], i) => {
        if (i % 2 === 0) doc.rect(ML, y6 - 1, CW, 16).fill("#f7f7f6");
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#444444").text(k, ML + 6, y6, { width: 195 });
        doc.font("Helvetica").fontSize(9).fillColor("#111111").text(v, ML + 205, y6, { width: CW - 210 });
        y6 += 16;
      });
      y6 += 8;
    }

    // Disclaimer
    doc.rect(ML, y6, CW, 1).fill("#dddddd");
    y6 += 10;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#555555").text("Disclaimer", ML, y6);
    y6 += 14;
    doc.font("Helvetica").fontSize(8).fillColor("#888888")
      .text(
        "This proposal is prepared by " + epc.name + " based on stated assumptions and publicly available data. " +
        "Estimated production, savings, and financial figures are indicative only and may differ from actual results due to " +
        "variations in weather, equipment performance, grid tariffs, and other factors. " +
        "This document does not constitute a legal, financial, or engineering commitment. " +
        "A detailed site survey and engineering study are recommended before final investment decisions.",
        ML, y6, { width: CW }
      );

    // Footer brand strip
    doc.rect(ML, PH - 38, CW, 1).fill(brand);
    doc.font("Helvetica").fontSize(8).fillColor("#888888")
      .text(`${epc.name}  ·  ${epc.email}  ·  Created with Perplexity Computer`, ML, PH - 28, { width: CW - 60, align: "left" });
    doc.font("Helvetica").fontSize(8).fillColor("#888888")
      .text(`${TOTAL_PAGES} / ${TOTAL_PAGES}`, ML, PH - 28, { width: CW, align: "right" });

    doc.end();
  });

  const pdfBuffer = Buffer.concat(chunks);
  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length":      String(pdfBuffer.length),
    },
  });
}
