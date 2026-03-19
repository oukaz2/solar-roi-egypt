import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runFinancialEngine } from "@/lib/financialEngine";
import { ESCALATION_PRESETS, REGION_LABELS, TARIFF_LABELS, ESCALATION_LABELS } from "@/lib/constants";
import type { LoanParams } from "@/lib/financialEngine";
// PDFKit is a CommonJS module — import via require to avoid ESM issues in Next.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id: Number(id) } });
  if (!project) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const epc = await prisma.epc.findUnique({ where: { id: project.epcId } });
  if (!epc) return NextResponse.json({ message: "EPC not found" }, { status: 404 });

  const loanParams: LoanParams | undefined =
    project.financingMode === "loan" && project.financingParams
      ? JSON.parse(project.financingParams)
      : undefined;

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

  const today   = new Date();
  const dateStr = today.toISOString().split("T")[0].replace(/-/g, "");
  const epcSlug = epc.name.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");
  const cliSlug = project.clientName.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");
  const filename = `${epcSlug}_${cliSlug}_SolarProposal_${dateStr}.pdf`;

  const hex    = (epc.brandColor ?? "#0d6e74").replace("#", "");
  const brandR = parseInt(hex.slice(0, 2), 16);
  const brandG = parseInt(hex.slice(2, 4), 16);
  const brandB = parseInt(hex.slice(4, 6), 16);

  const fmt = (n: number, dec = 0) =>
    new Intl.NumberFormat("en-EG", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);

  // Build PDF in memory
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ margin: 50, size: "A4" });

  await new Promise<void>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", resolve);
    doc.on("error", reject);

    const W = 595 - 100;  // page content width (50 margin each side)

    // ── Helper: page footer ─────────────────────────────────────────────────
    const drawFooter = (pageLabel: string) => {
      doc.rect(50, 770, W, 2).fill([brandR, brandG, brandB]);
      const footerParts = [epc.name, epc.email];
      if ((epc as any).phone) footerParts.push((epc as any).phone);
      footerParts.push(`Page ${pageLabel}`);
      doc.font("Helvetica").fontSize(8).fillColor("#888888")
        .text(footerParts.join("  ·  "), 50, 778, { align: "center", width: W });
    };

    // ── PAGE 1: Cover ──────────────────────────────────────────────────────
    doc.rect(50, 40, W, 6).fill([brandR, brandG, brandB]);

    // Logo (if EPC has one stored as base64)
    let logoBottom = 70;
    if (epc.logoUrl && epc.logoUrl.startsWith("data:image")) {
      try {
        const [meta, b64] = epc.logoUrl.split(",");
        const imgBuf = Buffer.from(b64, "base64");
        const mimeMatch = meta.match(/data:([^;]+)/);
        const imgType = mimeMatch ? mimeMatch[1] : "image/png";
        // PDFKit accepts buffer with type option
        doc.image(imgBuf, 50, 56, { height: 40, fit: [120, 40] });
        logoBottom = 104;
      } catch {
        // logo failed — continue without it
      }
    }

    doc.font("Helvetica-Bold").fontSize(22).fillColor([brandR, brandG, brandB]).text(epc.name, 50, logoBottom);
    doc.font("Helvetica").fontSize(10).fillColor("#555555").text(epc.email, 50, logoBottom + 27);
    doc.moveTo(50, logoBottom + 45).lineTo(50 + W, logoBottom + 45).stroke("#dddddd");

    const titleY = logoBottom + 60;
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#111111").text("Solar Investment Proposal", 50, titleY);
    doc.font("Helvetica").fontSize(11).fillColor("#333333")
      .text(`Prepared for: ${project.clientName}`, 50, titleY + 25)
      .text(`Site: ${project.siteName} — ${project.city}`, 50, titleY + 40)
      .text(`Date: ${today.toLocaleDateString("en-EG", { year: "numeric", month: "long", day: "numeric" })}`, 50, titleY + 55);

    // Bilingual rationale
    const rationaleY = titleY + 85;
    doc.roundedRect(50, rationaleY, W, 50, 4).fill("#f0f9f9").stroke(`#${hex}`);
    doc.font("Helvetica").fontSize(10).fillColor("#1a5c60")
      .text(
        `This proposal demonstrates the financial and environmental case for a ${fmt(project.systemSizeKwp, 1)} kWp solar installation at ${project.siteName}, offering significant electricity cost savings and a strong return on investment over a ${project.analysisPeriod}-year period.`,
        60, rationaleY + 8, { width: W - 20 }
      );
    // Arabic rationale (transliterated for font compatibility)
    doc.font("Helvetica").fontSize(8.5).fillColor("#888888")
      .text(
        `يُظهر هذا المقترح الجدوى المالية والبيئية لتركيب منظومة طاقة شمسية بقدرة ${fmt(project.systemSizeKwp, 1)} كيلوواط ذروة في ${project.siteName}، مع توفير ملحوظ في فاتورة الكهرباء وعائد استثمار مجزٍ على مدى ${project.analysisPeriod} عامًا.`,
        60, rationaleY + 32, { width: W - 20 }
      );

    // Executive summary box
    const execY = rationaleY + 65;
    doc.roundedRect(50, execY, W, 145, 6).fill("#f7f6f2").stroke("#e0dedd");
    doc.font("Helvetica-Bold").fontSize(12).fillColor([brandR, brandG, brandB]).text("Executive Summary", 65, execY + 13);

    const bullets = [
      `System size: ${fmt(project.systemSizeKwp, 1)} kWp — installed at ${project.siteName}, ${project.city}`,
      `Estimated annual production: ${fmt(result.annualProductionY1, 0)} kWh/yr (Year 1) · Avg over ${project.analysisPeriod} yr: ${fmt(result.annualProductionAvg, 0)} kWh/yr`,
      `Simple payback period: ${result.simplePayback !== null ? fmt(result.simplePayback, 1) + " years" : "> analysis period"}`,
      `${project.analysisPeriod}-year NPV at ${fmt(epc.discountRate * 100, 0)}% discount rate: EGP ${fmt(result.npv, 0)}`,
      `CO₂ avoided over ${project.analysisPeriod} years: ${fmt(result.co2SavedTonnes, 0)} tonnes`,
    ];
    doc.font("Helvetica").fontSize(10).fillColor("#222222");
    let bY = execY + 33;
    bullets.forEach(b => { doc.text(`•  ${b}`, 65, bY, { width: W - 30 }); bY += 21; });

    drawFooter("1");

    // ── PAGE 2: KPIs + Cashflow Chart ──────────────────────────────────────
    doc.addPage();
    doc.rect(50, 40, W, 6).fill([brandR, brandG, brandB]);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#111111").text("Financial Results", 50, 65);
    doc.moveTo(50, 85).lineTo(50 + W, 85).stroke("#dddddd");

    // KPI tiles
    const kpis = [
      { label: "Simple Payback", value: result.simplePayback !== null ? `${fmt(result.simplePayback, 1)} yrs` : "N/A" },
      { label: "NPV (25 yr)",    value: `EGP ${fmt(result.npv / 1e6, 2)}M` },
      { label: "IRR",            value: result.irr !== null ? `${fmt(result.irr * 100, 1)}%` : "N/A" },
    ];
    kpis.forEach((kpi, i) => {
      const x = 50 + i * (W / 3 + 5), bw = W / 3 - 8;
      doc.roundedRect(x, 95, bw, 55, 4).fill([brandR, brandG, brandB]);
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#ffffff").text(kpi.value, x, 107, { width: bw, align: "center" });
      doc.font("Helvetica").fontSize(9).fillColor("#ffffff").text(kpi.label, x, 131, { width: bw, align: "center" });
    });

    // ── Cashflow Chart (PDFKit primitives) ─────────────────────────────────
    const chartX = 50;
    const chartY = 168;
    const chartW = W;
    const chartH = 200;
    const n      = result.annualCashflows.length;

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111111").text("Annual & Cumulative Cashflow Chart", chartX, chartY - 16);

    // Chart background
    doc.rect(chartX, chartY, chartW, chartH).fill("#fafafa").stroke("#e0e0e0");

    // Determine scale
    const allVals  = [...result.annualCashflows, ...result.cumulativeCashflows];
    const maxVal   = Math.max(...allVals, 0);
    const minVal   = Math.min(...allVals, 0);
    const range    = maxVal - minVal || 1;

    // Zero line Y position
    const zeroY    = chartY + chartH * (maxVal / range);

    // Draw zero line
    doc.moveTo(chartX, zeroY).lineTo(chartX + chartW, zeroY).stroke("#cccccc");
    doc.font("Helvetica").fontSize(7).fillColor("#888888").text("0", chartX - 18, zeroY - 4, { width: 16, align: "right" });

    // Y-axis labels
    const labelVals = [maxVal, maxVal / 2, 0, minVal / 2, minVal].filter(v => v !== 0);
    labelVals.forEach(v => {
      const ly = chartY + chartH * ((maxVal - v) / range);
      doc.font("Helvetica").fontSize(7).fillColor("#aaaaaa")
        .text(fmt(v / 1e6, 1) + "M", chartX - 26, ly - 4, { width: 24, align: "right" });
      doc.moveTo(chartX, ly).lineTo(chartX + 5, ly).stroke("#e0e0e0");
    });

    // Bar width
    const barW   = Math.max(4, (chartW - 20) / n - 2);
    const stepX  = (chartW - 20) / n;
    const barPad = 10;

    // Draw bars (annual CF)
    result.annualCashflows.forEach((cf, i) => {
      const bx     = chartX + barPad + i * stepX + stepX * 0.1;
      const barHeight = Math.abs(cf) / range * chartH;
      const by     = cf >= 0 ? zeroY - barHeight : zeroY;
      const color  = cf >= 0 ? [brandR, brandG, brandB] as [number, number, number] : [192, 57, 43] as [number, number, number];
      doc.rect(bx, by, barW * 0.7, barHeight).fill(color);
    });

    // Draw cumulative CF line
    doc.save();
    doc.rect(chartX, chartY, chartW, chartH).clip();
    let pathStarted = false;
    result.cumulativeCashflows.forEach((cum, i) => {
      const px = chartX + barPad + i * stepX + stepX / 2;
      const py = chartY + chartH * ((maxVal - cum) / range);
      if (!pathStarted) {
        doc.moveTo(px, py);
        pathStarted = true;
      } else {
        doc.lineTo(px, py);
      }
    });
    doc.stroke("#f39c12");
    doc.restore();

    // Payback vertical marker
    if (result.simplePayback !== null && result.simplePayback <= n) {
      const pbX = chartX + barPad + (result.simplePayback - 0.5) * stepX + stepX / 2;
      doc.save();
      doc.rect(chartX, chartY, chartW, chartH).clip();
      // Dashed line: draw short segments
      const dashLen = 4, gapLen = 3;
      let y0 = chartY;
      while (y0 < chartY + chartH) {
        doc.moveTo(pbX, y0).lineTo(pbX, Math.min(y0 + dashLen, chartY + chartH)).stroke("#27ae60");
        y0 += dashLen + gapLen;
      }
      doc.restore();
      const pbLabelX = Math.min(pbX + 2, chartX + chartW - 55);
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#27ae60")
        .text(`✓ Payback yr ${fmt(result.simplePayback, 1)}`, pbLabelX, chartY + 4, { width: 55 });
    }

    // Chart legend
    doc.rect(chartX, chartY + chartH + 6, 10, 8).fill([brandR, brandG, brandB]);
    doc.font("Helvetica").fontSize(7.5).fillColor("#555").text("Annual CF", chartX + 13, chartY + chartH + 7);
    doc.moveTo(chartX + 80, chartY + chartH + 10).lineTo(chartX + 90, chartY + chartH + 10).lineWidth(2).stroke("#f39c12");
    doc.lineWidth(1);
    doc.font("Helvetica").fontSize(7.5).fillColor("#555").text("Cumulative CF", chartX + 93, chartY + chartH + 7);
    doc.rect(chartX + 175, chartY + chartH + 6, 10, 2).fill("#27ae60");
    doc.font("Helvetica").fontSize(7.5).fillColor("#555").text("Payback year", chartX + 188, chartY + chartH + 7);

    drawFooter("2");

    // ── PAGE 3: Annual Cashflow Table (full analysis period) ───────────────
    doc.addPage();
    doc.rect(50, 40, W, 6).fill([brandR, brandG, brandB]);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#111111").text("Annual Cashflow Detail", 50, 65);
    doc.moveTo(50, 85).lineTo(50 + W, 85).stroke("#dddddd");

    const cols = [50, 140, 265, 385, 455];
    const colW = [80, 120, 115, 65, 75];
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#555555");
    ["Year", "Annual CF (EGP)", "Cumulative CF (EGP)", "Payback?", "Prod. (MWh)"]
      .forEach((h, i) => doc.text(h, cols[i], 92, { width: colW[i] }));
    doc.moveTo(50, 105).lineTo(50 + W, 105).stroke("#cccccc");

    doc.font("Helvetica").fontSize(8.5).fillColor("#222222");
    const rowH    = 14.5;
    const maxPerPage = 36;   // rows per page (conservative)
    let rowsOnPage   = 0;
    let tY           = 109;

    for (let t = 0; t < result.annualCashflows.length; t++) {
      // New continuation page if needed
      if (rowsOnPage >= maxPerPage) {
        drawFooter("3");
        doc.addPage();
        doc.rect(50, 40, W, 6).fill([brandR, brandG, brandB]);
        doc.font("Helvetica-Bold").fontSize(14).fillColor("#111111").text("Annual Cashflow Detail (cont.)", 50, 65);
        doc.moveTo(50, 85).lineTo(50 + W, 85).stroke("#dddddd");
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#555555");
        ["Year", "Annual CF (EGP)", "Cumulative CF (EGP)", "Payback?", "Prod. (MWh)"]
          .forEach((h, i) => doc.text(h, cols[i], 92, { width: colW[i] }));
        doc.moveTo(50, 105).lineTo(50 + W, 105).stroke("#cccccc");
        doc.font("Helvetica").fontSize(8.5).fillColor("#222222");
        tY = 109;
        rowsOnPage = 0;
      }

      const cf  = result.annualCashflows[t];
      const cum = result.cumulativeCashflows[t];
      // Production with degradation: year-1 prod * (1 - 0.005)^t
      const prodThisYear = result.annualProductionY1 * Math.pow(1 - 0.005, t);
      const isP = result.simplePayback !== null &&
                  t >= Math.floor(result.simplePayback) &&
                  t < Math.floor(result.simplePayback) + 1;

      if (t % 2 === 0) doc.rect(50, tY - 1, W, rowH).fill("#fafaf9");
      doc.fillColor(cf < 0 ? "#c0392b" : "#222222").text(`${t + 1}`, cols[0], tY, { width: colW[0] });
      doc.fillColor(cf < 0 ? "#c0392b" : "#222222").text(fmt(cf, 0), cols[1], tY, { width: colW[1] });
      doc.fillColor(cum < 0 ? "#c0392b" : "#27ae60").text(fmt(cum, 0), cols[2], tY, { width: colW[2] });
      doc.fillColor(isP ? [brandR, brandG, brandB] : "#888888").text(isP ? "✓ Payback" : "—", cols[3], tY, { width: colW[3] });
      doc.fillColor("#555555").text(fmt(prodThisYear / 1000, 1), cols[4], tY, { width: colW[4] });

      tY += rowH;
      rowsOnPage++;
    }

    drawFooter("3");

    // ── PAGE 4: Technical & Financial Assumptions ──────────────────────────
    doc.addPage();
    doc.rect(50, 40, W, 6).fill([brandR, brandG, brandB]);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#111111").text("Technical & Financial Assumptions", 50, 65);
    doc.moveTo(50, 85).lineTo(50 + W, 85).stroke("#dddddd");

    const scRatio = project.selfConsumptionRatio ?? 0.8;
    const conKwh  = project.consumptionKwh ?? 0;

    const assumptions: [string, string][] = [
      ["System size",        `${fmt(project.systemSizeKwp, 1)} kWp`],
      ["Total CAPEX",        `EGP ${fmt(result.totalCapex, 0)} (EGP ${fmt(project.capexPerKwp, 0)}/kWp)`],
      ["Annual O&M",         `${project.oAndMPercent}% of CAPEX (EGP ${fmt(result.totalCapex * project.oAndMPercent / 100, 0)}/yr)`],
      ["Region",             REGION_LABELS[project.region] ?? project.region],
      ["Specific yield",     `${fmt(project.specificYield, 0)} kWh/kWp/year`],
      ["Annual production",  `${fmt(result.annualProductionY1, 0)} kWh/yr (Yr 1) · Avg: ${fmt(result.annualProductionAvg, 0)} kWh/yr`],
      ["Panel degradation",  "0.5% per year (applied in all cashflow years)"],
      ["Site consumption",   conKwh > 0 ? `${fmt(conKwh, 0)} kWh/yr` : "Not specified (production fully eligible)"],
      ["Self-consumption",   `${fmt(scRatio * 100, 0)}% of eligible production used on-site`],
      ["Self-consumed (Y1)", `${fmt(result.selfConsumedKwhY1, 0)} kWh/yr`],
      ["Exported (Y1)",      `${fmt(result.exportedKwhY1, 0)} kWh/yr at EGP ${fmt(project.exportTariff ?? 0, 3)}/kWh`],
      ["Grid tariff",        `EGP ${fmt(project.tariffValue, 3)}/kWh (${TARIFF_LABELS[project.tariffType] ?? project.tariffType})`],
      ["Tariff escalation",  ESCALATION_LABELS[project.escalationScenario] ?? project.escalationScenario],
      ["Financing mode",     project.financingMode === "loan" ? "Bank loan (annuity)" : "Cash purchase"],
      ...(loanParams ? [
        ["Loan share",       `${fmt(loanParams.loanShare * 100, 0)}% of CAPEX`] as [string, string],
        ["Interest rate",    `${fmt(loanParams.interestRate * 100, 1)}% p.a.`] as [string, string],
        ["Loan tenor",       `${loanParams.tenorYears} years`] as [string, string],
        ["Annual debt svc.", `EGP ${fmt(result.annualDebtService, 0)}`] as [string, string],
      ] : []),
      ["Analysis period",    `${project.analysisPeriod} years`],
      ["Discount rate",      `${fmt(epc.discountRate * 100, 1)}%`],
      ["CO₂ avoided",        `${fmt(result.co2SavedTonnes, 0)} tonnes over ${project.analysisPeriod} years (Egypt grid: 0.45 kg CO₂/kWh)`],
    ];

    let aY = 100;
    assumptions.forEach(([label, value], i) => {
      if (i % 2 === 0) doc.rect(50, aY - 2, W, 18).fill("#f7f6f2");
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#444444").text(label, 55, aY, { width: 200 });
      doc.font("Helvetica").fontSize(9.5).fillColor("#111111").text(value, 260, aY, { width: W - 210 });
      aY += 18;
    });

    doc.font("Helvetica").fontSize(8).fillColor("#aaaaaa")
      .text("Disclaimer: This proposal is based on stated assumptions. Actual results may vary. This document does not constitute a legal or financial commitment.", 50, aY + 20, { width: W });

    doc.rect(50, 770, W, 2).fill([brandR, brandG, brandB]);
    doc.font("Helvetica").fontSize(8).fillColor("#888888")
      .text(`${epc.name}  ·  ${epc.email}  ·  Created with Perplexity Computer`, 50, 778, { align: "center", width: W });

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
