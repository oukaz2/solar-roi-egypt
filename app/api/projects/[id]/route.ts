import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: Number(params.id) } });
  if (!project) return NextResponse.json({ message: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}
