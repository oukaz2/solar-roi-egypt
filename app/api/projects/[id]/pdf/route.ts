import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runFinancialEngine } from "@/lib/financialEngine";
import { ESCALATION_PRESETS, REGION_LABELS, TARIFF_LABELS, ESCALATION_LABELS } from "@/lib/constants";
import type { LoanParams } from "@/lib/financialEngine";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

export const dynamic = "force-dynamic";

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
  const brand      = hexToRgb(brandHex);
  const brandL     = lightenHex(brandHex, 0.88);
  const brandL35   = lightenHex(brandHex, 0.35);
  const brandL60   = lightenHex(brandHex, 0.60);
  // Darker variant for footer contrast — clamp RGB down by 30%
  const brandDarkHex = rgbToHex(brand.map(c => Math.max(0, Math.round(c * 0.7))) as [number,number,number]);

  const fmt = (n: number, dec = 0) =>
    new Intl.NumberFormat("en-EG", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);

  // Derived energy numbers
  const scRatio      = project.selfConsumptionRatio ?? 0.8;
  const conKwh       = project.consumptionKwh ?? 0;
  const prodY1       = result.annualProductionY1;
  const selfConsumed = result.selfConsumedKwhY1;
  const exported     = result.exportedKwhY1;
  const gridAvoided  = selfConsumed;
  const annualSavings = selfConsumed * project.tariffValue + exported * (project.exportTariff ?? 0);

  // ── Build PDF ─────────────────────────────────────────────────────────────
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ margin: 0, size: "A4" });

  await new Promise<void>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", resolve);
    doc.on("error", reject);

    const PW = 595;   // A4 width
    const PH = 842;   // A4 height
    const ML = 48;    // left margin
    const MR = 48;    // right margin
    const CW = PW - ML - MR;   // content width = 499

    // ── Helper: draw geometric sun icon ──────────────────────────────────
    const drawSunIcon = (cx: number, cy: number, r: number, color: string) => {
      // Circle
      doc.circle(cx, cy, r).fill(color);
      // 8 rays
      const rayLen = r * 1.6;
      for (let a = 0; a < 8; a++) {
        const angle = (a * Math.PI * 2) / 8;
        const x1 = cx + Math.cos(angle) * (r + 2);
        const y1 = cy + Math.sin(angle) * (r + 2);
        const x2 = cx + Math.cos(angle) * (r + rayLen);
        const y2 = cy + Math.sin(angle) * (r + rayLen);
        doc.moveTo(x1, y1).lineTo(x2, y2);
        doc.lineWidth(1.5);
        doc.stroke(color);
        doc.lineWidth(1);
      }
    };

    // ── Helper: draw clock icon ───────────────────────────────────────────
    const drawClockIcon = (cx: number, cy: number, r: number, color: string) => {
      doc.circle(cx, cy, r).stroke(color);
      // hour hand (pointing to ~10)
      doc.moveTo(cx, cy).lineTo(cx - r * 0.45, cy - r * 0.5);
      doc.lineWidth(2);
      doc.stroke(color);
      // minute hand (pointing to ~12)
      doc.moveTo(cx, cy).lineTo(cx, cy - r * 0.7);
      doc.lineWidth(1.5);
      doc.stroke(color);
      doc.lineWidth(1);
    };

    // ── Helper: draw coin/savings icon ────────────────────────────────────
    const drawCoinIcon = (cx: number, cy: number, r: number, color: string) => {
      doc.circle(cx, cy, r).fill(color);
      // EGP text inside
      doc.font("Helvetica-Bold").fontSize(r * 0.9).fillColor("#ffffff")
        .text("E", cx - r * 0.28, cy - r * 0.5, { continued: false });
    };

    // ── Helper: draw leaf/plant icon ──────────────────────────────────────
    const drawLeafIcon = (cx: number, cy: number, r: number, color: string) => {
      // Draw simple leaf shape using bezier curves
      doc.save();
      doc.moveTo(cx, cy + r)
        .bezierCurveTo(cx - r, cy, cx - r, cy - r, cx, cy - r)
        .bezierCurveTo(cx + r, cy - r, cx + r, cy, cx, cy + r)
        .fill(color);
      // Stem
      doc.moveTo(cx, cy + r * 0.1).lineTo(cx, cy + r * 1.3);
      doc.lineWidth(1.5);
      doc.stroke(color);
      doc.lineWidth(1);
      doc.restore();
    };

    // ── Helper: draw checkmark ────────────────────────────────────────────
    const drawCheckmark = (cx: number, cy: number, size: number, color: string) => {
      const s = size;
      doc.moveTo(cx - s * 0.5, cy)
        .lineTo(cx - s * 0.15, cy + s * 0.4)
        .lineTo(cx + s * 0.5, cy - s * 0.4);
      doc.lineWidth(2);
      doc.stroke(color);
      doc.lineWidth(1);
    };

    // ── Helper: draw donut chart slice ────────────────────────────────────
    const drawDonutSlice = (
      cx: number, cy: number, outerR: number, innerR: number,
      startAngle: number, endAngle: number, fillColor: string
    ) => {
      if (Math.abs(endAngle - startAngle) < 0.001) return;
      const sa = startAngle - Math.PI / 2;
      const ea = endAngle - Math.PI / 2;
      const x1 = cx + outerR * Math.cos(sa);
      const y1 = cy + outerR * Math.sin(sa);
      const x2 = cx + outerR * Math.cos(ea);
      const y2 = cy + outerR * Math.sin(ea);
      const x3 = cx + innerR * Math.cos(ea);
      const y3 = cy + innerR * Math.sin(ea);
      const x4 = cx + innerR * Math.cos(sa);
      const y4 = cy + innerR * Math.sin(sa);
      const large = (endAngle - startAngle) > Math.PI ? 1 : 0;
      // PDFKit path
      const path = `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${large} 0 ${x4} ${y4} Z`;
      doc.path(path).fill(fillColor);
    };

    // ── Helper: section header (vertical bar + title) ─────────────────────
    const sectionHeader = (text: string, y: number) => {
      doc.rect(ML, y, 4, 18).fill(brand);
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#111111").text(text, ML + 12, y + 2);
      return y + 32;
    };

    // ── Helper: standard page footer ─────────────────────────────────────
    const drawFooter = (pageNum: number, totalPages: number) => {
      doc.rect(0, PH - 36, PW, 36).fill(brandDarkHex);
      const footParts: string[] = [epc.name];
      if ((epc as any).phone) footParts.push((epc as any).phone);
      footParts.push(epc.email);
      doc.font("Helvetica").fontSize(8).fillColor("rgba(255,255,255,0.75)")
        .text(footParts.join("  ·  "), ML, PH - 22, { width: CW - 60, align: "left" });
      doc.font("Helvetica").fontSize(8).fillColor("rgba(255,255,255,0.75)")
        .text(`${pageNum} / ${totalPages}`, ML, PH - 22, { width: CW, align: "right" });
    };

    // ── Helper: draw a horizontal rule ────────────────────────────────────
    const hRule = (y: number, color = "#eeeeee") => {
      doc.rect(ML, y, CW, 0.75).fill(color);
    };

    const TOTAL_PAGES = 6;

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 1 — COVER
    // ════════════════════════════════════════════════════════════════════════

    // Bold colour block — top 45% of page
    const coverBlockH = Math.round(PH * 0.45);
    doc.rect(0, 0, PW, coverBlockH).fill(brand);

    // Subtle diagonal accent strip in cover block
    doc.save();
    doc.rect(0, 0, PW, coverBlockH).clip();
    doc.moveTo(PW * 0.55, 0).lineTo(PW, 0).lineTo(PW, coverBlockH).lineTo(PW * 0.75, coverBlockH).closePath()
      .fill(brandDarkHex);
    doc.restore();

    // EPC Logo top-right corner (on colour block)
    if (epc.logoUrl && epc.logoUrl.startsWith("data:image")) {
      try {
        const [, b64] = epc.logoUrl.split(",");
        const imgBuf  = Buffer.from(b64, "base64");
        doc.image(imgBuf, PW - ML - 120, 22, { height: 52, fit: [120, 52] });
      } catch { /* skip */ }
    }

    // EPC name + contact in white on color block
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff")
      .text(epc.name, ML, 32);
    const epcSub: string[] = [epc.email];
    if ((epc as any).phone) epcSub.push((epc as any).phone);
    doc.font("Helvetica").fontSize(9).fillColor("rgba(255,255,255,0.72)")
      .text(epcSub.join("  ·  "), ML, 50);

    // Category label + large project title
    doc.font("Helvetica-Bold").fontSize(9).fillColor("rgba(255,255,255,0.60)")
      .text("SOLAR INVESTMENT PROPOSAL", ML, coverBlockH - 148, { characterSpacing: 1.2 });

    const projTitle = (project as any).projectName || `Solar Proposal — ${project.clientName}`;
    doc.font("Helvetica-Bold").fontSize(28).fillColor("#ffffff")
      .text(projTitle, ML, coverBlockH - 124, { width: CW - 20, lineGap: 5 });

    // ── Three headline stats strip at bottom of colour block ─────────────
    const statStripY = coverBlockH - 52;
    const statW = CW / 3;
    const statItems = [
      { val: `${fmt(project.systemSizeKwp, 1)} kWp`, label: "System Size" },
      { val: result.simplePayback !== null ? `${fmt(result.simplePayback, 1)} yrs` : "N/A", label: "Simple Payback" },
      { val: `EGP ${fmt(annualSavings / 1000, 0)}K`, label: "Annual Savings Y1" },
    ];
    statItems.forEach((s, i) => {
      const sx = ML + i * statW;
      if (i > 0) {
        doc.moveTo(sx, statStripY + 4).lineTo(sx, statStripY + 36);
        doc.lineWidth(0.75);
        doc.stroke("rgba(255,255,255,0.3)");
        doc.lineWidth(1);
      }
      doc.font("Helvetica-Bold").fontSize(16).fillColor("#ffffff")
        .text(s.val, sx, statStripY + 4, { width: statW - 4, align: i === 0 ? "left" : "center" });
      doc.font("Helvetica").fontSize(8).fillColor("rgba(255,255,255,0.65)")
        .text(s.label, sx, statStripY + 24, { width: statW - 4, align: i === 0 ? "left" : "center" });
    });

    // ── White section below colour block ──────────────────────────────────
    // Thin accent line
    doc.rect(0, coverBlockH, PW, 4).fill(brandL35);

    const cvY = coverBlockH + 28;

    // Client / site / date info block
    const infoRows: [string, string][] = [
      ["Prepared for", project.clientName],
      ["Site", `${project.siteName}${(project as any).siteAddress ? " — " + (project as any).siteAddress : ""}, ${project.city}`],
      ...((project as any).gpsCoords ? [["GPS Coordinates", (project as any).gpsCoords] as [string, string]] : []),
      ["Date", today.toLocaleDateString("en-EG", { year: "numeric", month: "long", day: "numeric" })],
      ["Analysis Period", `${project.analysisPeriod} years`],
      ["Region", REGION_LABELS[project.region] ?? project.region],
    ];

    let cvRowY = cvY;
    infoRows.forEach(([k, v]) => {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#555555").text(k, ML, cvRowY, { width: 120 });
      doc.font("Helvetica").fontSize(10).fillColor("#111111").text(v, ML + 124, cvRowY, { width: CW - 124 });
      cvRowY += 18;
    });

    hRule(cvRowY + 4);
    cvRowY += 16;

    // Project note / rationale box (English only)
    const noteText = (project as any).projectNote
      || `This proposal presents the financial and environmental case for a ${fmt(project.systemSizeKwp, 1)} kWp solar installation at ${project.siteName}, ${project.city}. The system is projected to deliver significant electricity cost savings and a strong return on investment over the ${project.analysisPeriod}-year analysis period.`;

    doc.rect(ML, cvRowY, CW, 72).fillAndStroke(brandL, brandL60);
    doc.font("Helvetica").fontSize(9.5).fillColor("#1a5c60")
      .text(noteText, ML + 12, cvRowY + 10, { width: CW - 24, lineGap: 2 });

    cvRowY += 84;

    // Environmental headline teaser
    const co2Total = result.co2SavedTonnes;
    doc.rect(ML, cvRowY, CW, 44).fill("#f7f7f6");
    doc.font("Helvetica-Bold").fontSize(11).fillColor(brandHex)
      .text(`${fmt(co2Total, 0)} tonnes`, ML + 12, cvRowY + 8);
    doc.font("Helvetica").fontSize(9).fillColor("#555555")
      .text(`of CO2 avoided over ${project.analysisPeriod} years`, ML + 12, cvRowY + 26);

    doc.font("Helvetica").fontSize(9).fillColor("#555555")
      .text(`Total ${project.analysisPeriod}-yr NPV: EGP ${fmt(result.npv / 1e6, 2)}M  ·  IRR: ${result.irr !== null ? fmt(result.irr * 100, 1) + "%" : "N/A"}  ·  Payback: ${result.simplePayback !== null ? fmt(result.simplePayback, 1) + " yrs" : "N/A"}`,
        ML + 200, cvRowY + 16, { width: CW - 212 });

    drawFooter(1, TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 2 — PROJECT AT A GLANCE
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "A4" });

    // Header bar
    doc.rect(0, 0, PW, 52).fill(brand);
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#ffffff").text("Project at a Glance", ML, 18);

    let y2 = 70;

    // ── KPI icon strip (4 boxes) — drawn icons replace emoji ─────────────
    const kpiBoxH = 90;
    const kpiW = (CW - 12) / 4;
    const kpiData = [
      { label: "System Size",       value: `${fmt(project.systemSizeKwp, 1)} kWp`,  sub: "Installed capacity", iconType: "sun" },
      { label: "Simple Payback",    value: result.simplePayback !== null ? `${fmt(result.simplePayback, 1)} yrs` : "N/A", sub: "Full cost recovery", iconType: "clock" },
      { label: "Annual Savings Y1", value: `EGP ${fmt(annualSavings / 1000, 1)}K`,   sub: "Year 1 benefit",    iconType: "coin" },
      { label: "CO2 Avoided",       value: `${fmt(result.co2SavedTonnes, 0)} t`,     sub: `${project.analysisPeriod}-year total`,  iconType: "leaf" },
    ];
    kpiData.forEach((k, i) => {
      const kx = ML + i * (kpiW + 4);
      // Box background
      doc.rect(kx, y2, kpiW, kpiBoxH).fill(i % 2 === 0 ? brandL : "#f0f9f9");
      // Left accent bar
      doc.rect(kx, y2, 3, kpiBoxH).fill(brand);

      // Drawn icon top-center
      const iconCX = kx + kpiW / 2;
      const iconCY = y2 + 18;
      const iconR  = 8;
      if      (k.iconType === "sun")   drawSunIcon(iconCX, iconCY, iconR, brandHex);
      else if (k.iconType === "clock") drawClockIcon(iconCX, iconCY, iconR, brandHex);
      else if (k.iconType === "coin")  drawCoinIcon(iconCX, iconCY, iconR, brandHex);
      else if (k.iconType === "leaf")  drawLeafIcon(iconCX, iconCY, iconR - 1, brandHex);

      // Value (handle CO2 label specially)
      if (k.iconType === "leaf") {
        const valText = `${fmt(result.co2SavedTonnes, 0)} t`;
        const valFont = 14;
        doc.font("Helvetica-Bold").fontSize(valFont).fillColor(brandHex);
        const valW = doc.widthOfString(valText);
        const valX = kx + (kpiW - valW) / 2;
        doc.text(valText, valX, y2 + 34, { continued: false });
      } else {
        doc.font("Helvetica-Bold").fontSize(14).fillColor(brandHex)
          .text(k.value, kx, y2 + 34, { width: kpiW, align: "center" });
      }

      doc.font("Helvetica-Bold").fontSize(8).fillColor("#333333")
        .text(k.label, kx, y2 + 56, { width: kpiW, align: "center" });
      doc.font("Helvetica").fontSize(7.5).fillColor("#888888")
        .text(k.sub, kx, y2 + 68, { width: kpiW, align: "center" });
    });
    y2 += kpiBoxH + 16;

    // ── Executive summary bullets ─────────────────────────────────────────
    y2 = sectionHeader("Executive Summary", y2);
    const summaryBullets = [
      `System: ${fmt(project.systemSizeKwp,1)} kWp installed at ${project.siteName}, ${project.city} (${REGION_LABELS[project.region] ?? project.region})`,
      `Annual production (Year 1): ${fmt(prodY1,0)} kWh  ·  Average over ${project.analysisPeriod} years: ${fmt(result.annualProductionAvg,0)} kWh`,
      `Self-consumed: ${fmt(selfConsumed,0)} kWh (${fmt(scRatio*100,0)}% ratio)  ·  Exported: ${fmt(exported,0)} kWh`,
      conKwh > 0
        ? `Site consumption: ${fmt(conKwh,0)} kWh/yr  ·  Solar covers ${fmt(Math.min((selfConsumed/conKwh)*100,100),0)}% of site demand`
        : `Consumption not specified — unlimited self-consumption eligibility assumed`,
      `Simple payback: ${result.simplePayback !== null ? fmt(result.simplePayback,1)+" years" : "beyond analysis period"}  ·  IRR: ${result.irr !== null ? fmt(result.irr*100,1)+"%" : "N/A"}`,
      `${project.analysisPeriod}-year NPV at ${fmt(epc.discountRate*100,0)}% discount rate: EGP ${fmt(result.npv,0)}`,
      `CO2 avoided over ${project.analysisPeriod} years: ${fmt(result.co2SavedTonnes,0)} tonnes (0.45 kg/kWh Egypt grid factor)`,
    ];
    doc.font("Helvetica").fontSize(9.5).fillColor("#222222");
    summaryBullets.forEach(b => {
      doc.rect(ML, y2 + 1, 4, 10).fill(brand);
      doc.text(b, ML + 10, y2, { width: CW - 10 });
      y2 += 20;
    });
    y2 += 10;

    hRule(y2);
    y2 += 14;

    // ── System Overview table ─────────────────────────────────────────────
    y2 = sectionHeader("System Overview", y2);
    const bomRows: [string, string][] = [
      ["PV System",        `${fmt(project.systemSizeKwp,1)} kWp  ·  ${REGION_LABELS[project.region] ?? project.region}`],
      ["Solar Modules",    (project as any).moduleModel   || "Not specified"],
      ["Inverter",         (project as any).inverterModel || "Not specified"],
      ["Battery Storage",  (project as any).storageModel
        ? `${(project as any).storageModel}${(project as any).storageCapacityKwh ? " — "+fmt((project as any).storageCapacityKwh,0)+" kWh" : ""}`
        : "None"],
      ["Total Investment", `EGP ${fmt(result.totalCapex,0)}  (EGP ${fmt(project.capexPerKwp,0)}/kWp)`],
      ["Financing",        project.financingMode === "loan"
        ? `Bank Loan${loanParams ? ` — ${fmt(loanParams.loanShare*100,0)}% of CAPEX @ ${fmt(loanParams.interestRate*100,1)}% for ${loanParams.tenorYears} yrs` : ""}`
        : "Cash Purchase"],
    ];
    const tableRowH = 20;
    bomRows.forEach(([k, v], i) => {
      doc.rect(ML, y2, CW, tableRowH).fill(i % 2 === 0 ? "#f7f7f6" : "#ffffff");
      // Left key column with slightly bolder background
      doc.rect(ML, y2, 145, tableRowH).fill(i % 2 === 0 ? "#eeeeec" : "#f5f5f5");
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#444444").text(k, ML + 6, y2 + 5, { width: 133 });
      doc.font("Helvetica").fontSize(9).fillColor("#111111").text(v, ML + 152, y2 + 5, { width: CW - 158 });
      y2 += tableRowH;
    });
    // Bottom border on table
    doc.rect(ML, y2, CW, 1).fill("#dddddd");
    y2 += 16;

    // ── Tariff & Financial Parameters quick-ref ──────────────────────────
    y2 = sectionHeader("Financial Parameters", y2);
    const finRows: [string, string][] = [
      ["Grid tariff",      `EGP ${fmt(project.tariffValue,3)}/kWh  (${TARIFF_LABELS[project.tariffType] ?? project.tariffType})`],
      ["Export tariff",    (project.exportTariff ?? 0) > 0 ? `EGP ${fmt(project.exportTariff!,3)}/kWh` : "Not applicable"],
      ["Tariff escalation",ESCALATION_LABELS[project.escalationScenario] ?? project.escalationScenario],
      ["Discount rate",    `${fmt(epc.discountRate*100,1)}%`],
    ];
    finRows.forEach(([k, v], i) => {
      doc.rect(ML, y2, CW, tableRowH).fill(i % 2 === 0 ? "#f7f7f6" : "#ffffff");
      doc.rect(ML, y2, 145, tableRowH).fill(i % 2 === 0 ? "#eeeeec" : "#f5f5f5");
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#444444").text(k, ML + 6, y2 + 5, { width: 133 });
      doc.font("Helvetica").fontSize(9).fillColor("#111111").text(v, ML + 152, y2 + 5, { width: CW - 158 });
      y2 += tableRowH;
    });
    doc.rect(ML, y2, CW, 1).fill("#dddddd");

    drawFooter(2, TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 3 — ENERGY FLOW & SAVINGS
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "A4" });
    doc.rect(0, 0, PW, 52).fill(brand);
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#ffffff").text("Energy Flow & Savings", ML, 18);

    let y3 = 70;
    y3 = sectionHeader("Annual Energy Balance (Year 1)", y3);

    // ── Wide horizontal stacked bar chart ─────────────────────────────────
    const chartX3 = ML;
    const chartY3 = y3;
    const chartW3 = CW;
    const chartH3 = 56;  // taller

    const totalForChart = Math.max(prodY1, conKwh || prodY1);
    const barProdW  = Math.round((prodY1 / totalForChart) * chartW3);
    const barScW    = Math.round((selfConsumed / prodY1) * barProdW);
    const barExpW   = barProdW - barScW;

    // Production bar background (full production width)
    doc.rect(chartX3, chartY3, barProdW, chartH3).fill(brand);
    // Self-consumed overlay (darker)
    doc.rect(chartX3, chartY3, barScW, chartH3).fill(brandHex);
    // Exported segment (lighter tint)
    doc.rect(chartX3 + barScW, chartY3, barExpW, chartH3).fill(brandL35);

    // Grid dependency bar if applicable
    if (conKwh > 0 && conKwh > selfConsumed) {
      const gridKwh = conKwh - selfConsumed;
      const gridBarX = chartX3 + barProdW + 3;
      const gridBarW = Math.min(Math.round((gridKwh / totalForChart) * chartW3), chartW3 - barProdW - 3);
      if (gridBarW > 4) {
        doc.rect(gridBarX, chartY3, gridBarW, chartH3).fill("#c8c8c8");
        if (gridBarW > 30) {
          doc.font("Helvetica").fontSize(7.5).fillColor("#555555")
            .text(`Grid: ${fmt(gridKwh/1000,1)} MWh`, gridBarX + 4, chartY3 + 20, { width: gridBarW - 4 });
        }
      }
    }

    // Labels inside bars
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff")
      .text(`Self-consumed  ${fmt(selfConsumed/1000,1)} MWh`, chartX3 + 8, chartY3 + 10,
        { width: Math.max(barScW - 12, 60) });
    if (barExpW > 50) {
      doc.font("Helvetica").fontSize(8.5).fillColor("#ffffff")
        .text(`Export  ${fmt(exported/1000,1)} MWh`, chartX3 + barScW + 5, chartY3 + 10,
          { width: barExpW - 8 });
    }

    y3 = chartY3 + chartH3 + 8;

    // Legend row
    const legendItems = [
      { color: brandHex, label: "Self-consumed" },
      { color: brandL35, label: "Exported to grid" },
      ...(conKwh > 0 ? [{ color: "#c8c8c8", label: "Remaining from grid" }] : []),
    ];
    let legX3 = ML;
    legendItems.forEach(item => {
      doc.rect(legX3, y3 + 1, 10, 10).fill(item.color);
      doc.font("Helvetica").fontSize(8).fillColor("#444444").text(item.label, legX3 + 13, y3 + 2);
      legX3 += doc.widthOfString(item.label) + 34;
    });
    y3 += 22;

    hRule(y3);
    y3 += 16;

    // ── Donut chart + KPI breakdown side by side ──────────────────────────
    y3 = sectionHeader("Energy Split", y3);

    const donutR    = 60;
    const donutHole = 34;
    const donutCX   = ML + donutR + 10;
    const donutCY   = y3 + donutR + 10;

    // Draw donut slices
    const totalProdForDonut = prodY1;
    const scAngle  = (selfConsumed / totalProdForDonut) * Math.PI * 2;
    const expAngle = (exported / totalProdForDonut) * Math.PI * 2;

    // Slice 1: self-consumed
    drawDonutSlice(donutCX, donutCY, donutR, donutHole, 0, scAngle, brandHex);
    // Gap
    const gapAngle = 0.04;
    // Slice 2: exported
    drawDonutSlice(donutCX, donutCY, donutR, donutHole, scAngle + gapAngle, scAngle + expAngle, brandL35);
    // White center
    doc.circle(donutCX, donutCY, donutHole).fill("#ffffff");
    // Center text
    doc.font("Helvetica-Bold").fontSize(9).fillColor(brandHex)
      .text(`${fmt(scRatio*100,0)}%`, donutCX - 14, donutCY - 10, { width: 28, align: "center" });
    doc.font("Helvetica").fontSize(7).fillColor("#888888")
      .text("self-use", donutCX - 14, donutCY + 2, { width: 28, align: "center" });

    // ── KPI cards to the right of donut ───────────────────────────────────
    const donutRightX = ML + donutR * 2 + 30;
    const donutCardW  = CW - (donutRightX - ML);
    const kpiCardH    = 34;
    const kpiCardGap  = 6;

    const energyKpis = [
      { label: "Total Production",  value: `${fmt(prodY1/1000,1)} MWh`,       sub: "Year 1 output",              color: brandHex },
      { label: "Self-Consumed",     value: `${fmt(selfConsumed/1000,1)} MWh`,  sub: `${fmt(scRatio*100,0)}% of production`, color: brandHex },
      { label: "Exported to Grid",  value: `${fmt(exported/1000,1)} MWh`,     sub: `${fmt((exported/prodY1)*100,0)}% of production`, color: brandL35.replace(/#/, "") === "ffffff" ? brandHex : brandL35 },
      { label: "Grid Avoided",      value: `${fmt(gridAvoided/1000,1)} MWh`,  sub: "kWh not purchased",           color: "#27ae60" },
    ];
    const totalKpiH = energyKpis.length * (kpiCardH + kpiCardGap) - kpiCardGap;
    const kpiStartY = donutCY - totalKpiH / 2;

    energyKpis.forEach((k, i) => {
      const ky = kpiStartY + i * (kpiCardH + kpiCardGap);
      doc.rect(donutRightX, ky, donutCardW, kpiCardH).fill(i % 2 === 0 ? "#f7f7f6" : "#f0f9f9");
      doc.rect(donutRightX, ky, 3, kpiCardH).fill(k.color);
      doc.font("Helvetica-Bold").fontSize(13).fillColor(k.color)
        .text(k.value, donutRightX + 10, ky + 4, { width: donutCardW - 14 });
      doc.font("Helvetica").fontSize(8).fillColor("#666666")
        .text(`${k.label}  ·  ${k.sub}`, donutRightX + 10, ky + 20, { width: donutCardW - 14 });
    });

    y3 = donutCY + donutR + 24;

    hRule(y3);
    y3 += 16;

    // ── Savings explanation block ─────────────────────────────────────────
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
      `Over ${project.analysisPeriod} years (including tariff escalation & panel degradation), cumulative cashflow reaches EGP ${fmt(result.cumulativeCashflows[result.cumulativeCashflows.length-1],0)}.`,
    ].filter(Boolean) as string[];

    const savingsBoxH = savingsLines.length * 21 + 20;
    doc.rect(ML, y3 - 4, CW, savingsBoxH).fillAndStroke("#f0f9f9", brandL60);
    savingsLines.forEach((line, i) => {
      const isBold = i === savingsLines.length - 1;
      doc.font(isBold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor("#1a5c60")
        .text(line, ML + 12, y3 + 6 + i * 21, { width: CW - 24 });
    });
    y3 += savingsBoxH + 16;

    // ── Two-column highlights row ─────────────────────────────────────────
    const hlW = (CW - 8) / 2;
    const hlH = 44;
    // Left: Annual savings
    doc.rect(ML, y3, hlW, hlH).fill(brandL);
    doc.rect(ML, y3, 3, hlH).fill(brand);
    doc.font("Helvetica-Bold").fontSize(16).fillColor(brandHex)
      .text(`EGP ${fmt(totalAnnual/1000,1)}K`, ML + 10, y3 + 6, { width: hlW - 14 });
    doc.font("Helvetica").fontSize(8.5).fillColor("#555555")
      .text("Annual Savings (Year 1)", ML + 10, y3 + 28, { width: hlW - 14 });
    // Right: 25-yr cumulative
    doc.rect(ML + hlW + 8, y3, hlW, hlH).fill(brandL);
    doc.rect(ML + hlW + 8, y3, 3, hlH).fill(brand);
    const cum25 = result.cumulativeCashflows[Math.min(24, result.cumulativeCashflows.length - 1)];
    doc.font("Helvetica-Bold").fontSize(16).fillColor(brandHex)
      .text(`EGP ${fmt(cum25/1e6,2)}M`, ML + hlW + 18, y3 + 6, { width: hlW - 14 });
    doc.font("Helvetica").fontSize(8.5).fillColor("#555555")
      .text(`Cumulative CF (Year ${Math.min(25, project.analysisPeriod)})`, ML + hlW + 18, y3 + 28, { width: hlW - 14 });

    drawFooter(3, TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 4 — FINANCIAL RESULTS (KPIs + Cashflow Chart)
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "A4" });
    doc.rect(0, 0, PW, 52).fill(brand);
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#ffffff").text("Financial Results", ML, 18);

    let y4 = 70;

    // ── Three KPI tiles ───────────────────────────────────────────────────
    const finKpis = [
      { label: "Simple Payback",         value: result.simplePayback !== null ? `${fmt(result.simplePayback,1)} yrs` : "N/A",  sub: "Full cost recovery" },
      { label: `NPV (${project.analysisPeriod} yr)`, value: `EGP ${fmt(result.npv/1e6, 2)}M`, sub: `@ ${fmt(epc.discountRate*100,0)}% discount rate` },
      { label: "IRR",                    value: result.irr !== null ? `${fmt(result.irr*100,1)}%` : "N/A",                     sub: "Internal rate of return" },
    ];
    const fkW = (CW - 8) / 3;
    const fkH = 72;
    finKpis.forEach((k, i) => {
      const fx = ML + i * (fkW + 4);
      doc.rect(fx, y4, fkW, fkH).fill(brand);
      // Subtle lighter right accent
      doc.rect(fx + fkW - 4, y4, 4, fkH).fill(brandDarkHex);
      doc.font("Helvetica-Bold").fontSize(22).fillColor("#ffffff")
        .text(k.value, fx, y4 + 10, { width: fkW, align: "center" });
      doc.font("Helvetica").fontSize(8.5).fillColor("rgba(255,255,255,0.75)")
        .text(k.label, fx, y4 + 42, { width: fkW, align: "center" });
      doc.font("Helvetica").fontSize(7.5).fillColor("rgba(255,255,255,0.55)")
        .text(k.sub, fx, y4 + 55, { width: fkW, align: "center" });
    });
    y4 += fkH + 20;

    // ── Cashflow chart — taller to fill page ──────────────────────────────
    y4 = sectionHeader("Annual & Cumulative Cashflow", y4);

    const chartX4 = ML + 36;  // Y-axis label space
    const chartW4 = CW - 36;
    const chartH4 = 240;      // Taller chart
    const n4      = result.annualCashflows.length;

    doc.rect(chartX4, y4, chartW4, chartH4).fillAndStroke("#fafafa", "#e0e0e0");

    const allVals = [...result.annualCashflows, ...result.cumulativeCashflows];
    const maxVal  = Math.max(...allVals, 0);
    const minVal  = Math.min(...allVals, 0);
    const range   = maxVal - minVal || 1;
    const zeroY4  = y4 + chartH4 * (maxVal / range);

    // Grid lines
    [maxVal, maxVal * 0.5, 0, minVal * 0.5, minVal].filter(v => Math.abs(v) > 100).forEach(v => {
      const ly = y4 + chartH4 * ((maxVal - v) / range);
      doc.moveTo(chartX4, ly).lineTo(chartX4 + chartW4, ly);
      doc.lineWidth(0.4);
      doc.stroke(v === 0 ? "#bbbbbb" : "#e8e8e8");
      doc.lineWidth(1);
      doc.font("Helvetica").fontSize(7).fillColor("#999999")
        .text(`${fmt(v/1e6,1)}M`, ML, ly - 4, { width: 34, align: "right" });
    });

    // Zero axis line (thicker)
    doc.moveTo(chartX4, zeroY4).lineTo(chartX4 + chartW4, zeroY4);
    doc.lineWidth(1);
    doc.stroke("#aaaaaa");
    doc.lineWidth(1);

    const stepX4  = chartW4 / n4;
    const barW4   = Math.max(4, stepX4 * 0.6);
    const barPad4 = (stepX4 - barW4) / 2;

    result.annualCashflows.forEach((cf, i) => {
      const bx  = chartX4 + i * stepX4 + barPad4;
      const bh  = Math.max(1, Math.abs(cf) / range * chartH4);
      const by  = cf >= 0 ? zeroY4 - bh : zeroY4;
      const col: [number,number,number] = cf >= 0 ? brand : [192,57,43];
      doc.rect(bx, by, barW4, bh).fill(col);
    });

    // Cumulative line
    doc.save();
    doc.rect(chartX4, y4, chartW4, chartH4).clip();
    let started4 = false;
    result.cumulativeCashflows.forEach((cum, i) => {
      const px = chartX4 + i * stepX4 + stepX4 / 2;
      const py = y4 + chartH4 * ((maxVal - cum) / range);
      if (!started4) { doc.moveTo(px, py); started4 = true; } else { doc.lineTo(px, py); }
    });
    doc.lineWidth(2.5);
    doc.stroke("#f39c12");
    doc.lineWidth(1);
    doc.restore();

    // Payback marker (dashed vertical line)
    if (result.simplePayback !== null && result.simplePayback <= n4) {
      const pbX  = chartX4 + (result.simplePayback - 0.5) * stepX4 + stepX4 / 2;
      const pbXc = Math.max(chartX4 + 2, Math.min(pbX, chartX4 + chartW4 - 2));
      doc.save();
      doc.rect(chartX4, y4, chartW4, chartH4).clip();
      for (let dy = y4 + 2; dy < y4 + chartH4; dy += 8) {
        doc.moveTo(pbXc, dy).lineTo(pbXc, dy + 4);
        doc.lineWidth(1.5);
        doc.stroke("#27ae60");
        doc.lineWidth(1);
      }
      doc.restore();
      const lblX = Math.min(pbXc + 3, chartX4 + chartW4 - 70);
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#27ae60")
        .text(`Payback yr ${fmt(result.simplePayback,1)}`, lblX, y4 + 5, { width: 68 });
    }

    // X-axis labels (every 5 years)
    for (let i = 0; i < n4; i += 5) {
      const lx = chartX4 + i * stepX4 + stepX4 / 2 - 12;
      doc.font("Helvetica").fontSize(7.5).fillColor("#888888")
        .text(`Yr ${i+1}`, lx, y4 + chartH4 + 4, { width: 24, align: "center" });
    }

    y4 += chartH4 + 20;

    // Legend
    doc.rect(chartX4, y4, 11, 10).fill(brand);
    doc.font("Helvetica").fontSize(8).fillColor("#444444").text("Annual Cashflow", chartX4 + 14, y4 + 1);
    doc.rect(chartX4, y4, 11, 10).fill("#c0392b");  // red bar preview
    // draw negative example small
    doc.rect(chartX4 + 100, y4, 11, 10).fill("#c0392b");
    doc.font("Helvetica").fontSize(8).fillColor("#444444").text("Negative CF", chartX4 + 114, y4 + 1);
    doc.moveTo(chartX4 + 185, y4 + 5).lineTo(chartX4 + 200, y4 + 5);
    doc.lineWidth(2.5);
    doc.stroke("#f39c12");
    doc.lineWidth(1);
    doc.font("Helvetica").fontSize(8).fillColor("#444444").text("Cumulative CF", chartX4 + 204, y4 + 1);
    if (result.simplePayback !== null) {
      doc.moveTo(chartX4 + 300, y4 + 2).lineTo(chartX4 + 300, y4 + 10);
      doc.moveTo(chartX4 + 300, y4 + 4).lineTo(chartX4 + 300, y4 + 7);
      doc.lineWidth(1.5);
      doc.stroke("#27ae60");
      doc.lineWidth(1);
      doc.font("Helvetica").fontSize(8).fillColor("#444444").text("Payback year", chartX4 + 306, y4 + 1);
    }
    y4 += 20;

    // ── Summary financial metrics strip ───────────────────────────────────
    hRule(y4 + 4);
    y4 += 18;

    const finSummaryItems = [
      ["Total CAPEX",       `EGP ${fmt(result.totalCapex,0)}`],
      ["Annual O&M",        `EGP ${fmt(result.totalCapex * project.oAndMPercent / 100, 0)}/yr`],
      ...(loanParams ? [["Annual Debt Svc.", `EGP ${fmt(result.annualDebtService,0)}/yr`]] : []),
      ["25-yr Cum. CF",     `EGP ${fmt(cum25/1e6,2)}M`],
    ] as [string,string][];

    const fsW = CW / finSummaryItems.length;
    finSummaryItems.forEach(([k, v], i) => {
      const fx = ML + i * fsW;
      doc.font("Helvetica-Bold").fontSize(11).fillColor(brandHex).text(v, fx, y4, { width: fsW - 4 });
      doc.font("Helvetica").fontSize(7.5).fillColor("#888888").text(k, fx, y4 + 16, { width: fsW - 4 });
      if (i > 0) {
        doc.moveTo(fx - 2, y4).lineTo(fx - 2, y4 + 30);
        doc.lineWidth(0.5);
        doc.stroke("#dddddd");
        doc.lineWidth(1);
      }
    });

    drawFooter(4, TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 5 — FULL ANNUAL CASHFLOW TABLE
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "A4" });
    doc.rect(0, 0, PW, 52).fill(brand);
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#ffffff").text("Annual Cashflow Detail", ML, 18);

    let y5 = 66;
    const cols5   = [ML, ML+44, ML+152, ML+272, ML+358, ML+432];
    const colW5   = [40, 104, 116, 82, 70, 63];
    const headers5 = ["Year", "Annual CF (EGP)", "Cumulative CF (EGP)", "Milestone", "Prod. (MWh)", "O&M (EGP)"];

    const drawTableHeader5 = (y: number) => {
      doc.rect(ML, y, CW, 18).fill(brandHex);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff");
      headers5.forEach((h, i) => doc.text(h, cols5[i] + 3, y + 5, { width: colW5[i] - 3 }));
      return y + 20;
    };

    y5 = drawTableHeader5(y5);
    const rowH5    = 15;
    const maxRows5 = 44;
    let rowCount   = 0;

    for (let t = 0; t < result.annualCashflows.length; t++) {
      if (rowCount >= maxRows5) {
        drawFooter(5, TOTAL_PAGES);
        doc.addPage({ margin: 0, size: "A4" });
        doc.rect(0, 0, PW, 52).fill(brand);
        doc.font("Helvetica-Bold").fontSize(15).fillColor("#ffffff").text("Annual Cashflow Detail (cont.)", ML, 18);
        y5 = 66;
        y5 = drawTableHeader5(y5);
        rowCount = 0;
      }
      const cf  = result.annualCashflows[t];
      const cum = result.cumulativeCashflows[t];
      const prodThisYear = result.annualProductionY1 * Math.pow(0.995, t);
      const omThis = result.totalCapex * project.oAndMPercent / 100;
      const isPaybackYr = result.simplePayback !== null
        && t >= Math.floor(result.simplePayback)
        && t < Math.floor(result.simplePayback) + 1;
      const isBreakevenYr = cum >= 0 && (t === 0 || result.cumulativeCashflows[t-1] < 0);

      // Row background
      doc.rect(ML, y5, CW, rowH5).fill(t % 2 === 0 ? "#fafaf8" : "#ffffff");

      doc.font("Helvetica").fontSize(8.5);
      doc.fillColor(cf < 0 ? "#c0392b" : "#222222")
        .text(`${t+1}`, cols5[0] + 3, y5 + 3, { width: colW5[0] });
      doc.fillColor(cf < 0 ? "#c0392b" : "#222222")
        .text(fmt(cf,0), cols5[1] + 3, y5 + 3, { width: colW5[1] });
      doc.fillColor(cum < 0 ? "#c0392b" : "#27ae60")
        .text(fmt(cum,0), cols5[2] + 3, y5 + 3, { width: colW5[2] });

      // Milestone column — drawn checkmark or dash
      if (isPaybackYr || isBreakevenYr) {
        drawCheckmark(cols5[3] + 8, y5 + 8, 5, "#27ae60");
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#27ae60")
          .text("Payback", cols5[3] + 16, y5 + 3, { width: 60 });
      } else {
        doc.fillColor("#cccccc").text("—", cols5[3] + 3, y5 + 3, { width: colW5[3] });
      }
      doc.fillColor("#555555").text(fmt(prodThisYear/1000,1), cols5[4] + 3, y5 + 3, { width: colW5[4] });
      doc.fillColor("#555555").text(fmt(omThis,0), cols5[5] + 3, y5 + 3, { width: colW5[5] });

      // Row bottom border
      doc.moveTo(ML, y5 + rowH5).lineTo(ML + CW, y5 + rowH5);
      doc.lineWidth(0.3);
      doc.stroke("#eeeeee");
      doc.lineWidth(1);

      y5 += rowH5;
      rowCount++;
    }

    // Table totals row
    const totalCF = result.cumulativeCashflows[result.cumulativeCashflows.length - 1];
    doc.rect(ML, y5, CW, 18).fill(brandL);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(brandHex)
      .text("TOTAL", cols5[0] + 3, y5 + 5, { width: colW5[0] })
      .text("", cols5[1] + 3, y5 + 5, { width: colW5[1] })
      .fillColor(totalCF >= 0 ? "#27ae60" : "#c0392b")
      .text(fmt(totalCF, 0), cols5[2] + 3, y5 + 5, { width: colW5[2] });

    drawFooter(5, TOTAL_PAGES);

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 6 — ASSUMPTIONS & DISCLAIMER
    // ════════════════════════════════════════════════════════════════════════
    doc.addPage({ margin: 0, size: "A4" });
    doc.rect(0, 0, PW, 52).fill(brand);
    doc.font("Helvetica-Bold").fontSize(15).fillColor("#ffffff").text("Assumptions & Technical Data", ML, 18);

    let y6 = 70;
    y6 = sectionHeader("Key Assumptions", y6);

    const assumps: [string, string][] = [
      ["System size",           `${fmt(project.systemSizeKwp,1)} kWp`],
      ["Total CAPEX",           `EGP ${fmt(result.totalCapex,0)}  (EGP ${fmt(project.capexPerKwp,0)}/kWp)`],
      ["Annual O&M",            `${project.oAndMPercent}% of CAPEX — EGP ${fmt(result.totalCapex*project.oAndMPercent/100,0)}/yr`],
      ["Region / yield",        `${REGION_LABELS[project.region] ?? project.region} — ${fmt(project.specificYield,0)} kWh/kWp/yr`],
      ["Annual production Y1",  `${fmt(prodY1,0)} kWh  ·  Avg: ${fmt(result.annualProductionAvg,0)} kWh/yr`],
      ["Panel degradation",     "0.5% per year (compound, applied in all cashflow years)"],
      ["Site consumption",      conKwh > 0 ? `${fmt(conKwh,0)} kWh/yr` : "Not specified"],
      ["Self-consumption ratio",`${fmt(scRatio*100,0)}%`],
      ["Grid purchase tariff",  `EGP ${fmt(project.tariffValue,3)}/kWh  (${TARIFF_LABELS[project.tariffType] ?? project.tariffType})`],
      ["Export tariff",         (project.exportTariff ?? 0) > 0 ? `EGP ${fmt(project.exportTariff!,3)}/kWh` : "Not applicable"],
      ["Tariff escalation",     ESCALATION_LABELS[project.escalationScenario] ?? project.escalationScenario],
      ["Financing mode",        project.financingMode === "loan" ? "Bank loan (annuity)" : "Cash purchase"],
      ...(loanParams ? [
        ["Loan share",           `${fmt(loanParams.loanShare*100,0)}% of CAPEX`] as [string,string],
        ["Interest rate",        `${fmt(loanParams.interestRate*100,1)}% p.a.`] as [string,string],
        ["Loan tenor",           `${loanParams.tenorYears} years`] as [string,string],
        ["Annual debt service",  `EGP ${fmt(result.annualDebtService,0)}`] as [string,string],
      ] : []),
      ["Analysis period",       `${project.analysisPeriod} years`],
      ["Discount rate (NPV)",   `${fmt(epc.discountRate*100,1)}%`],
      ["CO2 factor",            "0.45 kg CO2/kWh (Egypt grid average)"],
      ["CO2 avoided",           `${fmt(result.co2SavedTonnes,0)} tonnes over ${project.analysisPeriod} years`],
      ...((project as any).gpsCoords ? [["GPS coordinates", (project as any).gpsCoords] as [string,string]] : []),
    ];

    const assumpRowH = 18;
    assumps.forEach(([k, v], i) => {
      doc.rect(ML, y6, CW, assumpRowH).fill(i % 2 === 0 ? "#f7f7f6" : "#ffffff");
      doc.rect(ML, y6, 195, assumpRowH).fill(i % 2 === 0 ? "#eeeeec" : "#f5f5f5");
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#444444").text(k, ML + 6, y6 + 4, { width: 183 });
      doc.font("Helvetica").fontSize(8.5).fillColor("#111111").text(v, ML + 200, y6 + 4, { width: CW - 206 });
      y6 += assumpRowH;
    });
    doc.rect(ML, y6, CW, 1).fill("#dddddd");
    y6 += 16;

    // ── Optional BOM section ─────────────────────────────────────────────
    const hasBom = (project as any).moduleModel || (project as any).inverterModel || (project as any).storageModel;
    if (hasBom) {
      y6 = sectionHeader("Equipment Summary", y6);
      const bomFull: [string,string][] = [
        ...((project as any).moduleModel   ? [["Solar Modules",   (project as any).moduleModel]   as [string,string]] : []),
        ...((project as any).inverterModel ? [["Inverter(s)",     (project as any).inverterModel] as [string,string]] : []),
        ...((project as any).storageModel  ? [["Battery Storage", `${(project as any).storageModel}${(project as any).storageCapacityKwh ? " — "+fmt((project as any).storageCapacityKwh,0)+" kWh" : ""}`] as [string,string]] : []),
      ];
      bomFull.forEach(([k, v], i) => {
        doc.rect(ML, y6, CW, assumpRowH).fill(i % 2 === 0 ? "#f7f7f6" : "#ffffff");
        doc.rect(ML, y6, 195, assumpRowH).fill(i % 2 === 0 ? "#eeeeec" : "#f5f5f5");
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#444444").text(k, ML + 6, y6 + 4, { width: 183 });
        doc.font("Helvetica").fontSize(8.5).fillColor("#111111").text(v, ML + 200, y6 + 4, { width: CW - 206 });
        y6 += assumpRowH;
      });
      doc.rect(ML, y6, CW, 1).fill("#dddddd");
      y6 += 16;
    }

    // ── Disclaimer ────────────────────────────────────────────────────────
    hRule(y6, "#dddddd");
    y6 += 12;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#555555").text("Disclaimer", ML, y6);
    y6 += 14;
    doc.font("Helvetica").fontSize(8).fillColor("#888888")
      .text(
        "This proposal is prepared by " + epc.name + " based on stated assumptions and publicly available data. " +
        "Estimated production, savings, and financial figures are indicative only and may differ from actual results due to " +
        "variations in weather, equipment performance, grid tariffs, and other factors. " +
        "This document does not constitute a legal, financial, or engineering commitment. " +
        "A detailed site survey and engineering study are recommended before final investment decisions.",
        ML, y6, { width: CW, lineGap: 2 }
      );

    drawFooter(6, TOTAL_PAGES);

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
