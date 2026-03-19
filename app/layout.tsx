import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Navbar } from "@/components/Navbar";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "SolarROI Egypt – C&I Solar Proposal Generator",
  description: "Generate branded solar investment proposals with ROI metrics for C&I clients in Egypt. Calculate payback, NPV, and IRR in under 5 minutes.",
  keywords: ["solar", "Egypt", "ROI", "C&I", "proposal", "photovoltaic", "EPC"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <div className="min-h-screen flex flex-col bg-background">
            <Navbar />
            <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
              {children}
            </main>
            <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
              SolarROI Egypt &middot; C&amp;I Solar Proposal Generator &middot;{" "}
              <a
                href="https://www.perplexity.ai/computer"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground transition-colors"
              >
                Created with Perplexity Computer
              </a>
            </footer>
          </div>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
