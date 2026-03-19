import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateEpcSchema = z.object({
  name:         z.string().min(1).optional(),
  email:        z.string().email().optional(),
  logoUrl:      z.string().nullable().optional(),
  brandColor:   z.string().optional(),
  discountRate: z.number().min(0.01).max(0.5).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const epc = await prisma.epc.findUnique({ where: { id: Number(id) } });
  if (!epc) return NextResponse.json({ message: "EPC not found" }, { status: 404 });
  return NextResponse.json(epc);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = updateEpcSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const epc = await prisma.epc.update({
      where: { id: Number(id) },
      data: parsed.data,
    });
    return NextResponse.json(epc);
  } catch {
    return NextResponse.json({ message: "EPC not found" }, { status: 404 });
  }
}
