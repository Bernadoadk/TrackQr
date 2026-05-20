import React, { useEffect, useRef, useState } from "react";
import { Outlet, useNavigation } from "react-router";
import { Sidebar } from "./Sidebar";
import { ToastProvider } from "../ui/Toast";
import { TweaksPanel, TweakValues, TWEAK_DEFAULTS } from "../ui/TweaksPanel";

/* ── Accent palette ── light-mode derived vars per preset */
const ACCENT_LIGHT: Record<string, {
  hover: string; soft: string; softer: string; fg: string; border: string;
}> = {
  "#2563EB": { hover: "#1D4FD8", soft: "#EFF4FF", softer: "#F5F8FF", fg: "#2353D8", border: "#C7D7FF" },
  "#7C3AED": { hover: "#6D28D9", soft: "#F5F3FF", softer: "#FAF8FF", fg: "#6D28D9", border: "#DDD6FE" },
  "#16A34A": { hover: "#15803D", soft: "#F0FDF4", softer: "#F7FEF9", fg: "#15803D", border: "#BBF7D0" },
  "#D97706": { hover: "#B45309", soft: "#FFFBEB", softer: "#FFFEF5", fg: "#B45309", border: "#FDE68A" },
  "#DB2777": { hover: "#BE185D", soft: "#FDF2F8", softer: "#FEF7FB", fg: "#BE185D", border: "#FBCFE8" },
};

/* dark-mode derived vars per preset */
const ACCENT_DARK: Record<string, {
  hover: string; soft: string; softer: string; fg: string; border: string;
}> = {
  "#2563EB": { hover: "#7AA3FF", soft: "rgba(96,145,255,0.10)",  softer: "rgba(96,145,255,0.05)",  fg: "#B5CBFF", border: "rgba(96,145,255,0.28)"  },
  "#7C3AED": { hover: "#A78BFA", soft: "rgba(167,139,250,0.10)", softer: "rgba(167,139,250,0.05)", fg: "#C4B5FD", border: "rgba(167,139,250,0.28)" },
  "#16A34A": { hover: "#4ADE80", soft: "rgba(74,222,128,0.10)",  softer: "rgba(74,222,128,0.05)",  fg: "#86EFAC", border: "rgba(74,222,128,0.28)"  },
  "#D97706": { hover: "#FCD34D", soft: "rgba(251,191,36,0.10)",  softer: "rgba(251,191,36,0.05)",  fg: "#FCD34D", border: "rgba(251,191,36,0.28)"  },
  "#DB2777": { hover: "#F472B6", soft: "rgba(244,114,182,0.10)", softer: "rgba(244,114,182,0.05)", fg: "#F9A8D4", border: "rgba(244,114,182,0.28)" },
};

/** Push all accent-derived CSS custom properties to :root */
function applyAccent(accent: string, theme: "light" | "dark") {
  const root = document.documentElement;
  const palette = theme === "dark" ? ACCENT_DARK[accent] : ACCENT_LIGHT[accent];
  if (!palette) return; // unknown preset — leave as-is
  root.style.setProperty("--accent",       accent);
  root.style.setProperty("--accent-hover", palette.hover);
  root.style.setProperty("--accent-soft",  palette.soft);
  root.style.setProperty("--accent-softer",palette.softer);
  root.style.setProperty("--accent-fg",    palette.fg);
  root.style.setProperty("--accent-border",palette.border);
}

/** Persist + load tweaks from localStorage, merging with defaults */
function loadTweaks(): TweakValues {
  if (typeof window === "undefined") return { ...TWEAK_DEFAULTS };
  try {
    const raw = localStorage.getItem("tqr-tweaks");
    if (raw) return { ...TWEAK_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  // Backwards-compat: if only the old theme key exists
  const legacyTheme = localStorage.getItem("tqr-theme") as "light" | "dark" | null;
  return { ...TWEAK_DEFAULTS, ...(legacyTheme ? { theme: legacyTheme } : {}) };
}

export function AppShell() {
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";
  const appRef = useRef<HTMLDivElement>(null);

  const [tweaks, setTweaks] = useState<TweakValues>(loadTweaks);

  /* Apply theme + accent CSS vars on every tweak change */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", tweaks.theme);
    applyAccent(tweaks.accent, tweaks.theme);
    localStorage.setItem("tqr-theme",   tweaks.theme);
    localStorage.setItem("tqr-tweaks",  JSON.stringify(tweaks));
  }, [tweaks]);

  /* Apply density + sidebar-collapsed as data-attrs on the app container */
  useEffect(() => {
    const el = appRef.current;
    if (!el) return;
    el.setAttribute("data-density",   tweaks.density);
    el.setAttribute("data-collapsed", String(tweaks.sidebarCollapsed));
  }, [tweaks.density, tweaks.sidebarCollapsed]);

  const handleTweak = (
    key: keyof TweakValues,
    value: TweakValues[keyof TweakValues],
  ) => setTweaks(prev => ({ ...prev, [key]: value }));

  return (
    <ToastProvider>
      {/* Navigation progress bar */}
      <div className={`toploader ${isNavigating ? "active" : ""}`} />

      <div ref={appRef} className="tqr-app">
        <Sidebar
          theme={tweaks.theme}
          onTheme={t => handleTweak("theme", t)}
        />
        <main className="tqr-content">
          <div className="tqr-content-inner">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Floating tweaks panel — renders its own fixed-position button / panel */}
      <TweaksPanel values={tweaks} onChange={handleTweak} />
    </ToastProvider>
  );
}
