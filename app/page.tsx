"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Sun, FileText, Settings, BarChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useEpc } from "@/components/Providers";
import type { ProjectData } from "@/lib/types";
import { format } from "date-fns";

function fmt(n: number | null | undefined, dec = 0) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-EG", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n);
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">{label}</div>
        <div className="kpi-value text-foreground">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function HomePage() {
  const { activeEpc, activeEpcId } = useEpc();
  const [projects, setProjects] = useState<ProjectData[] | null>(null);
  const brand = activeEpc?.brandColor ?? "#0d6e74";

  useEffect(() => {
    if (!activeEpcId) return;
    fetch(`/api/projects?epcId=${activeEpcId}`).then(r => r.json()).then(setProjects).catch(() => {});
  }, [activeEpcId]);

  const totalKwp   = projects?.reduce((s, p) => s + p.systemSizeKwp, 0) ?? 0;
  const validPb    = projects?.filter(p => p.simplePayback != null) ?? [];
  const avgPayback = validPb.length > 0 ? validPb.reduce((s, p) => s + p.simplePayback!, 0) / validPb.length : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{activeEpc ? `${activeEpc.name} Dashboard` : "SolarROI Egypt"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">C&amp;I Solar Proposal Generator — Egypt Market</p>
        </div>
        <Link href="/projects/new">
          <Button size="sm" className="gap-1.5" style={{ backgroundColor: brand }}>
            <Plus className="w-3.5 h-3.5"/> New Proposal
          </Button>
        </Link>
      </div>

      {!activeEpc && projects === null && (
        <Card className="border-dashed border-2">
          <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-primary/10 p-4"><Settings className="w-8 h-8 text-primary"/></div>
            <div>
              <h2 className="font-semibold">Set up your EPC profile first</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">Add your company name, email, logo, and brand color. This appears on all generated proposals.</p>
            </div>
            <Link href="/setup"><Button size="sm">Configure EPC Profile</Button></Link>
          </CardContent>
        </Card>
      )}

      {activeEpc && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {projects === null ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}><CardContent className="pt-5"><Skeleton className="h-3 w-20 mb-2"/><Skeleton className="h-7 w-16"/></CardContent></Card>
              ))
            ) : (
              <>
                <MetricCard label="Proposals" value={String(projects.length)} sub="all time"/>
                <MetricCard label="Total kWp Quoted" value={totalKwp > 0 ? `${(totalKwp/1000).toFixed(1)} MWp` : "—"} sub="across all projects"/>
                <MetricCard label="Avg. Payback" value={avgPayback ? `${avgPayback.toFixed(1)} yrs` : "—"} sub="simple payback"/>
                <MetricCard label="EPC" value={activeEpc.name.split(" ")[0]} sub={activeEpc.email}/>
              </>
            )}
          </div>

          <Card>
            <CardHeader className="py-4 px-5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4 text-muted-foreground"/> Recent Proposals
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {projects === null ? (
                <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full"/>)}</div>
              ) : projects.length > 0 ? (
                <div className="divide-y divide-border">
                  {[...projects].sort((a,b) => new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()).slice(0, 8).map(p => (
                    <div key={p.id} className="py-2.5 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{p.clientName}</div>
                        <div className="text-xs text-muted-foreground">{p.siteName} · {p.city} · {p.systemSizeKwp} kWp</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono font-medium">{p.simplePayback ? `${p.simplePayback.toFixed(1)} yrs` : "—"}</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(p.createdAt), "d MMM yyyy")}</div>
                      </div>
                      <Link href={`/projects/${p.id}`}>
                        <Button variant="outline" size="sm" className="text-xs">View</Button>
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Sun className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3"/>
                  <p className="text-sm text-muted-foreground">No proposals yet</p>
                  <Link href="/projects/new"><Button size="sm" variant="outline" className="mt-3">Create your first proposal</Button></Link>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
