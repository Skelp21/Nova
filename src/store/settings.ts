import { create } from "zustand";
import { persist } from "zustand/middleware";
import { EQ_FREQS, type EqState } from "../lib/audio";
import type { Source } from "../lib/types";

export type ThemeId = "dark" | "amoled" | "midnight" | "forest" | "light";

export const THEMES: { id: ThemeId; name: string; bg: string; card: string; fg: string }[] = [
  { id: "dark", name: "Тёмная", bg: "#0b0b0c", card: "#151517", fg: "#f4f4f5" },
  { id: "amoled", name: "AMOLED", bg: "#000000", card: "#0c0c0c", fg: "#ffffff" },
  { id: "midnight", name: "Полночь", bg: "#0a0d1a", card: "#121731", fg: "#e8ecff" },
  { id: "forest", name: "Лес", bg: "#0a120d", card: "#111d16", fg: "#e9f5ec" },
  { id: "light", name: "Светлая", bg: "#f5f5f7", card: "#ffffff", fg: "#111113" },
];

export const ACCENTS = ["#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#ffffff"];

interface SettingsState {
  theme: ThemeId;
  accent: string;
  coverBackdrop: boolean;
  compactRows: boolean;
  volume: number;
  muted: boolean;
  rate: number;
  eq: EqState;
  eqPreset: string;
  customPresets: Record<string, number[]>;
  enabledSources: Record<Source, boolean>;
  importSource: Source;
  downloadDir: string;
  discord: { enabled: boolean; clientId: string };
  waveSkipDisliked: boolean;
  set: (patch: Partial<SettingsState>) => void;
  setEq: (patch: Partial<EqState>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "dark",
      accent: "#8b5cf6",
      coverBackdrop: true,
      compactRows: false,
      volume: 0.8,
      muted: false,
      rate: 1,
      eq: { enabled: false, preamp: 0, bands: EQ_FREQS.map(() => 0) },
      eqPreset: "Ровно",
      customPresets: {},
      enabledSources: { youtube: true, soundcloud: true, vk: true, yandex: true },
      importSource: "youtube",
      downloadDir: "",
      discord: { enabled: false, clientId: "" },
      waveSkipDisliked: true,
      set: (patch) => set(patch),
      setEq: (patch) => set((s) => ({ eq: { ...s.eq, ...patch } })),
    }),
    { name: "nota-settings", version: 1 },
  ),
);

/** Writes theme colours into CSS variables. */
export function applyTheme(themeId: ThemeId, accent: string) {
  const t = THEMES.find((x) => x.id === themeId) ?? THEMES[0];
  const root = document.documentElement;
  root.dataset.theme = t.id;
  root.style.setProperty("--bg", t.bg);
  root.style.setProperty("--card", t.card);
  root.style.setProperty("--fg", t.fg);
  const acc = t.id === "light" && accent.toLowerCase() === "#ffffff" ? "#111113" : accent;
  root.style.setProperty("--accent", acc);
  // Text on accent: dark for light accents.
  const hex = acc.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  root.style.setProperty("--on-accent", lum > 0.6 ? "#000" : "#fff");
  try {
    localStorage.setItem("nota-theme-vars", JSON.stringify({ bg: t.bg, card: t.card, fg: t.fg, accent: acc }));
  } catch {
    /* storage unavailable */
  }
}
