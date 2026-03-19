"use client";
import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useEpc } from "@/components/Providers";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";

const schema = z.object({
  name:                z.string().min(2, "Required"),
  email:               z.string().email("Invalid email"),
  phone:               z.string().optional(),
  brandColor:          z.string().default("#0d6e74"),
  discountRatePercent: z.number().min(1).max(50).default(11),
});
type FormData = z.infer<typeof schema>;

export default function SetupPage() {
  const { activeEpcId, activeEpc, setActiveEpcId, setActiveEpc, refreshEpc } = useEpc();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const { register, handleSubmit, watch, setValue, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", phone: "", brandColor: "#0d6e74", discountRatePercent: 11 },
  });

  useEffect(() => {
    if (activeEpc) {
      reset({
        name:                activeEpc.name,
        email:               activeEpc.email,
        phone:               (activeEpc as any).phone ?? "",
        brandColor:          activeEpc.brandColor ?? "#0d6e74",
        discountRatePercent: Math.round((activeEpc.discountRate ?? 0.11) * 100),
      });
      // Restore persisted logo (now stored as base64 in DB — survives Vercel cold starts)
      if (activeEpc.logoUrl) setLogoPreview(activeEpc.logoUrl);
    }
  }, [activeEpc, reset]);

  const brandColor = watch("brandColor") ?? "#0d6e74";

  const onSubmit = async (data: FormData) => {
    const payload = {
      name:         data.name,
      email:        data.email,
      phone:        data.phone ?? null,
      brandColor:   data.brandColor,
      discountRate: data.discountRatePercent / 100,
    };
    try {
      if (activeEpcId) {
        const res = await fetch(`/api/epcs/${activeEpcId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const epc = await res.json();
        setActiveEpc(epc);
        toast({ title: "Profile updated" });
      } else {
        const res = await fetch("/api/epcs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const epc = await res.json();
        setActiveEpcId(epc.id);
        setActiveEpc(epc);
        toast({ title: "EPC profile created", description: `${epc.name} is ready.` });
      }
    } catch {
      toast({ title: "Error", description: "Failed to save.", variant: "destructive" });
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeEpcId) return;
    // Show instant preview
    const reader = new FileReader();
    reader.onload = ev => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    // Upload to API — stored as base64 in DB (persists across Vercel cold starts)
    setLogoUploading(true);
    const fd = new FormData();
    fd.append("logo", file);
    try {
      const res  = await fetch(`/api/epcs/${activeEpcId}/logo`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.logoUrl) {
        setLogoPreview(data.logoUrl);
        await refreshEpc();
        toast({ title: "Logo saved", description: "Logo will appear on all future PDF proposals." });
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setLogoUploading(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">EPC Profile</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your branding appears on all generated PDF proposals.</p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{activeEpcId ? "Edit Profile" : "Create EPC Profile"}</CardTitle>
          <CardDescription>Fill in your company details below.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="name">Company Name *</Label>
              <Input id="name" placeholder="e.g. SunTech Energy Solutions" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Contact Email *</Label>
                <Input id="email" type="email" placeholder="info@yourcompany.com" {...register("email")} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone Number</Label>
                <Input id="phone" type="tel" placeholder="+20 100 000 0000" {...register("phone")} />
                <p className="text-xs text-muted-foreground">Appears in PDF footer</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Brand Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="h-9 w-12 cursor-pointer rounded border border-border p-0.5"
                    {...register("brandColor")}
                  />
                  <Input
                    value={brandColor}
                    onChange={e => setValue("brandColor", e.target.value)}
                    className="font-mono text-sm"
                    placeholder="#0d6e74"
                  />
                </div>
                <div className="h-2 rounded-full mt-1" style={{ backgroundColor: brandColor }} />
              </div>
              <div className="space-y-1.5">
                <Label>Logo Upload</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => fileRef.current?.click()}
                    disabled={!activeEpcId || logoUploading}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {logoUploading ? "Uploading…" : "Choose file"}
                  </Button>
                  {logoPreview && (
                    <img src={logoPreview} alt="logo" className="h-9 w-9 object-contain rounded border" />
                  )}
                  {!activeEpcId && (
                    <span className="text-xs text-muted-foreground">Save profile first</span>
                  )}
                </div>
                {logoPreview && activeEpcId && (
                  <p className="text-xs text-green-600">Logo saved — persists across sessions</p>
                )}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dr">Discount Rate for NPV (%)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="dr"
                  type="number"
                  step="0.5"
                  min="1"
                  max="50"
                  className="w-28"
                  {...register("discountRatePercent", { valueAsNumber: true })}
                />
                <span className="text-sm text-muted-foreground">% per year (WACC / hurdle rate)</span>
              </div>
              {errors.discountRatePercent && (
                <p className="text-xs text-destructive">{errors.discountRatePercent.message}</p>
              )}
            </div>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full gap-2"
              style={{ backgroundColor: brandColor }}
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              ) : (
                <><CheckCircle2 className="w-4 h-4" /> {activeEpcId ? "Save Changes" : "Create Profile"}</>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
