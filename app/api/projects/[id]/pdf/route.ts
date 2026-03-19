import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runFinancialEngine } from "@/lib/financialEngine";
import { ESCALATION_PRESETS, REGION_LABELS, TARIFF_LABELS, ESCALATION_LABELS } from "@/lib/constants";
import type { LoanParams } from "@/lib/financialEngine";
// PDFKit is a CommonJS module — import via require to avoid ESM issues in Next.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require("pdfkit") as typeof import("pdfkit");

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: Number(params.id) } });
  if (!project) return NextResponse.json({ message: "Not found" }, { status: 404 });

  const epc = await prisma.epc.findUnique({ where: { id: project.epcId } });
  if (!epc) return NextResponse.json({ message: "EPC not found" }, { status: 404 });

  const loanParams: LoanParams | undefined =
    project.financingMode === "loan" && project.financingParams
      ? JSON.parse(project.financingParams)
      : undefined;

  const result = runFinancialEngine({
    systemSizeKwp:  project.systemSizeKwp,
    region:         project.region,
    capexPerKwp:    project.capexPerKwp,
    oAndMPercent:   project.oAndMPercent,
    tariffValue:    project.tariffValue,
    escalationRate: ESCALATION_PRESETS[project.escalationScenario] ?? 0,
    financingMode:  project.financingMode as "cash" | "loan",
    loanParams,
    analysisPeriod: project.analysisPeriod,
    discountRate:   epc.discountRate,
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

    const W = 595 - 100;

    // ── PAGE 1: Cover ──────────────────────────────────────────────────────
    doc.rect(50, 40, W, 6).fill([brandR, brandG, brandB]);
    doc.font("Helvetica-Bold").fontSize(22).fillColor([brandR, brandG, brandB]).text(epc.name, 50, 70);
    doc.font("Helvetica").fontSize(10).fillColor("#555555").text(epc.email, 50, 97);
    doc.moveTo(50, 115).lineTo(50 + W, 115).stroke("#dddddd");

    doc.font("Helvetica-Bold").fontSize(16).fillColor("#111111").text("Solar Investment Proposal", 50, 130);
    doc.font("Helvetica").fontSize(11).fillColor("#333333")
      .text(`Prepared for: ${project.clientName}`, 50, 155)
      .text(`Site: ${project.siteName} — ${project.city}`, 50, 170)
      .text(`Date: ${today.toLocaleDateString("en-EG", { year: "numeric", month: "long", day: "numeric" })}`, 50, 185);

    doc.roundedRect(50, 215, W, 145, 6).fill("#f7f6f2").stroke("#e0dedd");
    doc.font("Helvetica-Bold").fontSize(12).fillColor([brandR, brandG, brandB]).text("Executive Summary", 65, 228);

    const bullets = [
      `System size: ${fmt(project.systemSizeKwp, 1)} kWp — installed at ${project.siteName}, ${project.city}`,
      `Estimated annual production: ${fmt(result.annualProduction, 0)} kWh (${REGION_LABELS[project.region] ?? project.region})`,
      `Simple payback period: ${result.simplePayback !== null ? fmt(result.simplePayback, 1) + " years" : "> analysis period"}`,
      `25-year NPV at ${fmt(epc.discountRate * 100, 0)}% discount rate: EGP ${fmt(result.npv, 0)}`,
    ];
    doc.font("Helvetica").fontSize(10).fillColor("#222222");
    let bY = 248;
    bullets.forEach(b => { doc.text(`•  ${b}`, 65, bY, { width: W - 30 }); bY += 23; });

    doc.rect(50, 770, W, 2).fill([brandR, brandG, brandB]);
    doc.font("Helvetica").fontSize(8).fillColor("#888888")
      .text("Confidential – prepared exclusively for the named recipient", 50, 778, { align: "center", width: W });

    // ── PAGE 2: Metrics + Cashflow table ────────────────────────────────────
    doc.addPage();
    doc.rect(50, 40, W, 6).fill([brandR, brandG, brandB]);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#111111").text("Financial Results", 50, 65);
    doc.moveTo(50, 85).lineTo(50 + W, 85).stroke("#dddddd");

    const kpis = [
      { label: "Simple Payback", value: result.simplePayback !== null ? `${fmt(result.simplePayback, 1)} yrs` : "N/A" },
      { label: "NPV (25 yr)",    value: `EGP ${fmt(result.npv, 0)}` },
      { label: "IRR",            value: result.irr !== null ? `${fmt(result.irr * 100, 1)}%` : "N/A" },
    ];
    kpis.forEach((kpi, i) => {
      const x = 50 + i * (W / 3 + 5), bw = W / 3 - 8;
      doc.roundedRect(x, 95, bw, 55, 4).fill([brandR, brandG, brandB]);
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#ffffff").text(kpi.value, x, 107, { width: bw, align: "center" });
      doc.font("Helvetica").fontSize(9).fillColor("#ffffff").text(kpi.label, x, 131, { width: bw, align: "center" });
    });

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111111").text("Annual Cashflow (EGP)", 50, 172);
    doc.moveTo(50, 188).lineTo(50 + W, 188).stroke("#cccccc");

    const cols = [50, 180, 310, 445];
    const colW = [120, 120, 120, 100];
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#555555");
    ["Year", "Annual CF (EGP)", "Cumulative CF (EGP)", "Payback?"].forEach((h, i) => doc.text(h, cols[i], 192, { width: colW[i] }));
    doc.moveTo(50, 206).lineTo(50 + W, 206).stroke("#cccccc");

    doc.font("Helvetica").fontSize(9).fillColor("#222222");
    const maxRows = Math.min(result.annualCashflows.length, 15);
    for (let t = 0; t < maxRows; t++) {
      const y  = 210 + t * 16;
      const cf  = result.annualCashflows[t];
      const cum = result.cumulativeCashflows[t];
      const isP = result.simplePayback !== null && Math.floor(result.simplePayback) === t;
      if (t % 2 === 0) doc.rect(50, y - 2, W, 16).fill("#fafaf9");
      doc.fillColor(cf < 0 ? "#c0392b" : "#222222").text(`${t + 1}`, cols[0], y, { width: colW[0] });
      doc.text(fmt(cf, 0), cols[1], y, { width: colW[1] });
      doc.fillColor(cum < 0 ? "#c0392b" : "#27ae60").text(fmt(cum, 0), cols[2], y, { width: colW[2] });
      doc.fillColor(isP ? [brandR, brandG, brandB] : "#888888").text(isP ? "✓ Payback" : "—", cols[3], y, { width: colW[3] });
    }

    doc.rect(50, 770, W, 2).fill([brandR, brandG, brandB]);
    doc.font("Helvetica").fontSize(8).fillColor("#888888")
      .text("Confidential – prepared exclusively for the named recipient", 50, 778, { align: "center", width: W });

    // ── PAGE 3: Assumptions ─────────────────────────────────────────────────
    doc.addPage();
    doc.rect(50, 40, W, 6).fill([brandR, brandG, brandB]);
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#111111").text("Technical & Financial Assumptions", 50, 65);
    doc.moveTo(50, 85).lineTo(50 + W, 85).stroke("#dddddd");

    const assumptions: [string, string][] = [
      ["System size",      `${fmt(project.systemSizeKwp, 1)} kWp`],
      ["Total CAPEX",      `EGP ${fmt(result.totalCapex, 0)} (EGP ${fmt(project.capexPerKwp, 0)}/kWp)`],
      ["Annual O&M",       `${project.oAndMPercent}% of CAPEX (EGP ${fmt(result.totalCapex * project.oAndMPercent / 100, 0)}/yr)`],
      ["Region",           REGION_LABELS[project.region] ?? project.region],
      ["Specific yield",   `${fmt(project.specificYield, 0)} kWh/kWp/year`],
      ["Annual production",`${fmt(result.annualProduction, 0)} kWh/year`],
      ["Tariff type",      TARIFF_LABELS[project.tariffType] ?? project.tariffType],
      ["Starting tariff",  `EGP ${fmt(project.tariffValue, 3)}/kWh`],
      ["Tariff escalation",ESCALATION_LABELS[project.escalationScenario] ?? project.escalationScenario],
      ["Financing mode",   project.financingMode === "loan" ? "Bank loan (annuity)" : "Cash purchase"],
      ...(loanParams ? [
        ["Loan share",        `${fmt(loanParams.loanShare * 100, 0)}% of CAPEX`] as [string, string],
        ["Interest rate",     `${fmt(loanParams.interestRate * 100, 1)}% p.a.`] as [string, string],
        ["Loan tenor",        `${loanParams.tenorYears} years`] as [string, string],
        ["Annual debt svc.",  `EGP ${fmt(result.annualDebtService, 0)}`] as [string, string],
      ] : []),
      ["Analysis period",  `${project.analysisPeriod} years`],
      ["Discount rate",    `${fmt(epc.discountRate * 100, 1)}%`],
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
