import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const createEpcSchema = z.object({
  name:         z.string().min(1),
  email:        z.string().email(),
  logoUrl:      z.string().optional().nullable(),
  brandColor:   z.string().default("#0d6e74"),
  discountRate: z.number().min(0.01).max(0.5).default(0.11),
});

export async function GET() {
  const epcs = await prisma.epc.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(epcs);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createEpcSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const epc = await prisma.epc.create({ data: parsed.data });
  return NextResponse.json(epc, { status: 201 });
}
