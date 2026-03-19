"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useEpc } from "@/components/Providers";
import { useToast } from "@/hooks/use-toast";
import type { ProjectData } from "@/lib/types";
import { Plus, FileText, ExternalLink, Trash2 } from "lucide-react";
import { REGION_LABELS } from "@/lib/constants";

function fmt(n: number | null | undefined, dec = 0) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-EG", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(n);
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

export default function ProjectsPage() {
  const { activeEpcId, activeEpc } = useEpc();
  const { toast } = useToast();
  const qc = useQueryClient();
  const brandColor = activeEpc?.brandColor ?? "#0d6e74";

  const { data: projects, isLoading } = useQuery<ProjectData[]>({
    queryKey: ["/api/projects", activeEpcId],
    queryFn: async () => {
      const url = activeEpcId ? `/api/projects?epcId=${activeEpcId}` : "/api/projects";
      const res = await fetch(url);
      return res.json();
    },
    enabled: true,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/projects", activeEpcId] });
      toast({ title: "Proposal deleted" });
    },
    onError: () => {
      toast({ title: "Delete failed", variant: "destructive" });
    },
  });

  const handleDelete = (p: ProjectData) => {
    if (!confirm(`Delete proposal for "${p.clientName}"? This cannot be undone.`)) return;
    deleteMutation.mutate(p.id);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">All Proposals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {projects?.length ?? 0} proposal
            {(projects?.length ?? 0) !== 1 ? "s" : ""} for{" "}
            {activeEpc?.name ?? "your EPC"}
          </p>
        </div>
        <Link href="/projects/new">
          <Button
            size="sm"
            className="gap-1.5"
            style={{ backgroundColor: brandColor }}
            data-testid="button-new-proposal-list"
          >
            <Plus className="w-3.5 h-3.5" />
            New Proposal
          </Button>
        </Link>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-4">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : !projects?.length ? (
        <Card className="border-dashed border-2">
          <CardContent className="pt-10 pb-10 flex flex-col items-center gap-4 text-center">
            <FileText className="w-10 h-10 text-muted-foreground/30" />
            <div>
              <div className="font-semibold">No proposals yet</div>
              <div className="text-sm text-muted-foreground mt-1">
                Create your first C&amp;I solar proposal
              </div>
            </div>
            <Link href="/projects/new">
              <Button size="sm" data-testid="button-create-first-project">
                Create Proposal
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {[...projects]
            .sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime()
            )
            .map((p) => (
              <Card
                key={p.id}
                className="hover:border-primary/30 transition-colors"
                data-testid={`card-project-${p.id}`}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-0">
                    {/* Identity */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">
                          {p.clientName}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {p.financingMode === "loan" ? "Loan" : "Cash"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {p.siteName} · {p.city} ·{" "}
                        {REGION_LABELS[p.region] ?? p.region}
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="flex items-center gap-6 text-xs sm:mx-6">
                      <div>
                        <div className="text-muted-foreground">Size</div>
                        <div className="font-mono font-medium">
                          {fmt(p.systemSizeKwp, 0)} kWp
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Payback</div>
                        <div className="font-mono font-medium">
                          {p.simplePayback
                            ? `${p.simplePayback.toFixed(1)} yr`
                            : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">NPV</div>
                        <div className="font-mono font-medium">
                          {p.npv != null
                            ? `EGP ${fmt(p.npv / 1e6, 1)}M`
                            : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">IRR</div>
                        <div className="font-mono font-medium">
                          {p.irr != null
                            ? `${(p.irr * 100).toFixed(1)}%`
                            : "—"}
                        </div>
                      </div>
                      <div className="hidden sm:block text-muted-foreground">
                        {formatDate(p.createdAt)}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Link href={`/projects/${p.id}`}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          data-testid={`button-open-${p.id}`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive px-2"
                        onClick={() => handleDelete(p)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${p.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
