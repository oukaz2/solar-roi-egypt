"use client";
import { useState, useEffect, createContext, useContext } from "react";
import type { EpcData } from "@/lib/types";

// ── Theme ────────────────────────────────────────────────────────────────────
type Theme = "light" | "dark";
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(dark ? "dark" : "light");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  return (
    <ThemeCtx.Provider value={{ theme, toggle: () => setTheme(t => t === "dark" ? "light" : "dark") }}>
      {children}
    </ThemeCtx.Provider>
  );
}
export const useTheme = () => useContext(ThemeCtx);

// ── EPC Context ───────────────────────────────────────────────────────────────
interface EpcCtxType {
  activeEpcId: number | null;
  setActiveEpcId: (id: number | null) => void;
  activeEpc: EpcData | null;
  setActiveEpc: (epc: EpcData | null) => void;
  refreshEpc: () => Promise<void>;
}
const EpcCtx = createContext<EpcCtxType>({
  activeEpcId: null, setActiveEpcId: () => {},
  activeEpc: null, setActiveEpc: () => {}, refreshEpc: async () => {},
});

function EpcProvider({ children }: { children: React.ReactNode }) {
  const [activeEpcId, setActiveEpcId] = useState<number | null>(null);
  const [activeEpc, setActiveEpc] = useState<EpcData | null>(null);

  const refreshEpc = async () => {
    try {
      const res = await fetch("/api/epcs");
      const epcs: EpcData[] = await res.json();
      if (epcs.length > 0) {
        setActiveEpcId(epcs[0].id);
        setActiveEpc(epcs[0]);
      }
    } catch {}
  };

  useEffect(() => { refreshEpc(); }, []);

  useEffect(() => {
    if (activeEpcId) {
      fetch(`/api/epcs/${activeEpcId}`)
        .then(r => r.json())
        .then(setActiveEpc)
        .catch(() => {});
    }
  }, [activeEpcId]);

  return (
    <EpcCtx.Provider value={{ activeEpcId, setActiveEpcId, activeEpc, setActiveEpc, refreshEpc }}>
      {children}
    </EpcCtx.Provider>
  );
}
export const useEpc = () => useContext(EpcCtx);

// ── Combined providers ────────────────────────────────────────────────────────
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <EpcProvider>{children}</EpcProvider>
    </ThemeProvider>
  );
}
