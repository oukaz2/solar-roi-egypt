import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const formData = await req.formData();
    const file = formData.get("logo") as File | null;
    if (!file) return NextResponse.json({ message: "No file" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });

    const ext  = file.name.split(".").pop() || "png";
    const name = `epc-${params.id}-${Date.now()}.${ext}`;
    await writeFile(path.join(uploadsDir, name), buffer);

    const logoUrl = `/uploads/${name}`;
    const epc = await prisma.epc.update({
      where: { id: Number(params.id) },
      data: { logoUrl },
    });
    return NextResponse.json({ logoUrl, epc });
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: 500 });
  }
}
