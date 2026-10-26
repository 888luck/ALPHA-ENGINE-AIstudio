// ==============================================================================
//        ALPHA ENGINE - INSTITUTIONAL DISPLAY DENSITY & SCALING ENGINE
// ==============================================================================
// Supports 3 institutional display tiers:
// 1. "compact": Base font 11.5px, 24px table row height, maximum data density.
// 2. "standard": Base font 13px, 28px table row height, standard 1080p/1440p scale.
// 3. "comfort": Base font 14.5px, 34px table row height, high readability.
// ==============================================================================

import { useState, useEffect } from "react";

export type TerminalDensity = "compact" | "standard" | "comfort";

const STORAGE_KEY = "alpha_terminal_density";
const DEFAULT_DENSITY: TerminalDensity = "standard";

export function getStoredDensity(): TerminalDensity {
  if (typeof window === "undefined") return DEFAULT_DENSITY;
  const stored = localStorage.getItem(STORAGE_KEY) as TerminalDensity;
  if (stored === "compact" || stored === "standard" || stored === "comfort") {
    return stored;
  }
  return DEFAULT_DENSITY;
}

export function applyDensityToDocument(density: TerminalDensity): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-density", density);
  if (document.body) {
    document.body.setAttribute("data-density", density);
  }
}

export function useTerminalDensity(): [TerminalDensity, (next: TerminalDensity) => void] {
  const [density, setDensityState] = useState<TerminalDensity>(() => getStoredDensity());

  useEffect(() => {
    applyDensityToDocument(density);
  }, [density]);

  const setDensity = (next: TerminalDensity) => {
    setDensityState(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyDensityToDocument(next);
    window.dispatchEvent(new CustomEvent("alpha_density_changed", { detail: { density: next } }));
  };

  // Keyboard accelerators: Alt + [ (decrease/dense) and Alt + ] (increase/comfort)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "[") {
        e.preventDefault();
        setDensityState((prev) => {
          const next: TerminalDensity = prev === "comfort" ? "standard" : "compact";
          localStorage.setItem(STORAGE_KEY, next);
          applyDensityToDocument(next);
          return next;
        });
      } else if (e.altKey && e.key === "]") {
        e.preventDefault();
        setDensityState((prev) => {
          const next: TerminalDensity = prev === "compact" ? "standard" : "comfort";
          localStorage.setItem(STORAGE_KEY, next);
          applyDensityToDocument(next);
          return next;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return [density, setDensity];
}
