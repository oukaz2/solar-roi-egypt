import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Logo is stored as a base64 data URL directly in the DB.
// This avoids any filesystem writes — critical for Vercel serverless
// where the filesystem is ephemeral and files disappear between invocations.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const formData = await req.formData();
    const file = formData.get("logo") as File | null;
    if (!file) return NextResponse.json({ message: "No file" }, { status: 400 });

    const bytes  = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const mime   = file.type || "image/png";

    // Store as inline data URL — no disk I/O, survives Vercel cold starts
    const logoUrl = `data:${mime};base64,${buffer.toString("base64")}`;

    const epc = await prisma.epc.update({
      where: { id: Number(id) },
      data: { logoUrl },
    });
    return NextResponse.json({ logoUrl, epc });
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: 500 });
  }
}
