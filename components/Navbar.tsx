"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sun, Moon, BarChart2, Plus, FileText, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme, useEpc } from "@/components/Providers";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/",            label: "Dashboard",    icon: BarChart2 },
  { href: "/projects/new",label: "New Proposal", icon: Plus },
  { href: "/projects",    label: "Projects",     icon: FileText },
  { href: "/setup",       label: "EPC Setup",    icon: Settings },
];

export function Navbar() {
  const { theme, toggle } = useTheme();
  const pathname = usePathname();
  const { activeEpc } = useEpc();
  const brand = activeEpc?.brandColor ?? "#0d6e74";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center justify-center rounded-lg w-8 h-8" style={{ backgroundColor: brand }}>
            <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5">
              <circle cx="12" cy="12" r="4" fill="white"/>
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"
                stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </span>
          <span className="font-semibold text-sm hidden sm:block">
            {activeEpc ? activeEpc.name : "SolarROI Egypt"}
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-0.5 flex-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link key={href} href={href}>
                <Button variant="ghost" size="sm"
                  className={cn("gap-1.5 text-xs font-medium",
                    active ? "text-primary bg-primary/8" : "text-muted-foreground hover:text-foreground")}>
                  <Icon className="w-3.5 h-3.5"/>
                  <span className="hidden sm:inline">{label}</span>
                </Button>
              </Link>
            );
          })}
        </nav>

        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={toggle} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="w-4 h-4"/> : <Moon className="w-4 h-4"/>}
        </Button>
      </div>
    </header>
  );
}
