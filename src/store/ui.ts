import { create } from "zustand";
import type { Track } from "../lib/types";
import { uid } from "../lib/format";

export type Route =
  | { name: "home" }
  | { name: "search"; query?: string }
  | { name: "liked" }
  | { name: "history" }
  | { name: "downloads" }
  | { name: "playlists" }
  | { name: "playlist"; id: string }
  | { name: "settings"; tab?: string }
  | { name: "library" };

export type Modal =
  | { type: "addToPlaylist"; tracks: Track[] }
  | { type: "createPlaylist"; tracks?: Track[] }
  | { type: "renamePlaylist"; id: string }
  | { type: "equalizer" }
  | { type: "import" }
  | { type: "trackInfo"; track: Track }
  | { type: "linkPlaylist"; id: string };

export interface MenuState {
  x: number;
  y: number;
  track: Track;
  /** Set when the row belongs to a user playlist. */
  playlistId?: string;
  index?: number;
}

export interface Toast {
  id: string;
  text: string;
  kind: "info" | "error" | "success";
}

interface UiState {
  route: Route;
  back: Route[];
  forward: Route[];
  rightPanel: "queue" | "lyrics" | null;
  nowPlaying: boolean;
  modal: Modal | null;
  menu: MenuState | null;
  toasts: Toast[];
  downloading: Record<string, number>;
  go: (r: Route) => void;
  goBack: () => void;
  goForward: () => void;
  setPanel: (p: UiState["rightPanel"]) => void;
  setNowPlaying: (v: boolean) => void;
  togglePanel: (p: "queue" | "lyrics") => void;
  openModal: (m: Modal) => void;
  closeModal: () => void;
  openMenu: (m: MenuState) => void;
  closeMenu: () => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  setDownloading: (id: string, p: number | null) => void;
}

export const useUi = create<UiState>((set, get) => ({
  route: { name: "home" },
  back: [],
  forward: [],
  rightPanel: null,
  nowPlaying: false,
  modal: null,
  menu: null,
  toasts: [],
  downloading: {},
  go: (r) => {
    const cur = get().route;
    if (JSON.stringify(cur) === JSON.stringify(r)) return;
    set({ route: r, back: [...get().back.slice(-50), cur], forward: [], nowPlaying: false });
  },
  goBack: () => {
    const { back, route, forward } = get();
    if (!back.length) return;
    set({ route: back[back.length - 1], back: back.slice(0, -1), forward: [route, ...forward] });
  },
  goForward: () => {
    const { back, route, forward } = get();
    if (!forward.length) return;
    set({ route: forward[0], forward: forward.slice(1), back: [...back, route] });
  },
  setPanel: (p) => set({ rightPanel: p }),
  setNowPlaying: (v) => set({ nowPlaying: v }),
  togglePanel: (p) => set({ rightPanel: get().rightPanel === p ? null : p }),
  openModal: (m) => set({ modal: m, menu: null }),
  closeModal: () => set({ modal: null }),
  openMenu: (m) => set({ menu: m }),
  closeMenu: () => set({ menu: null }),
  toast: (text, kind = "info") => {
    const id = uid();
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === "error" ? 6000 : 3500);
  },
  setDownloading: (id, p) => {
    const next = { ...get().downloading };
    if (p === null) delete next[id];
    else next[id] = p;
    set({ downloading: next });
  },
}));

export const toast = (text: string, kind?: Toast["kind"]) => useUi.getState().toast(text, kind);
