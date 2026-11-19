import { create } from "zustand";
import { api, errText } from "../lib/api";
import { uid } from "../lib/format";
import type { DownloadEntry, HistoryEntry, Playlist, Track } from "../lib/types";
import { toast, useUi } from "./ui";
import { useSettings } from "./settings";

interface LibraryData {
  likes: Track[];
  dislikes: string[];
  playlists: Playlist[];
  history: HistoryEntry[];
  downloads: Record<string, DownloadEntry>;
}

interface LibraryState extends LibraryData {
  loaded: boolean;
  load: () => Promise<void>;
  toggleLike: (t: Track) => void;
  toggleDislike: (t: Track) => void;
  createPlaylist: (name: string, tracks?: Track[], origin?: string) => string;
  renamePlaylist: (id: string, name: string) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, tracks: Track[]) => number;
  removeFromPlaylist: (id: string, index: number) => void;
  moveInPlaylist: (id: string, from: number, to: number) => void;
  pushHistory: (t: Track) => void;
  clearHistory: () => void;
  download: (tracks: Track[]) => Promise<void>;
  removeDownload: (id: string, deleteFile: boolean) => Promise<void>;
}

const MAX_HISTORY = 500;

export const useLibrary = create<LibraryState>((set, get) => ({
  likes: [],
  dislikes: [],
  playlists: [],
  history: [],
  downloads: {},
  loaded: false,

  load: async () => {
    try {
      const raw = (await api.libraryLoad()) as Partial<LibraryData> | null;
      if (raw) {
        set({
          likes: raw.likes ?? [],
          dislikes: raw.dislikes ?? [],
          playlists: raw.playlists ?? [],
          history: raw.history ?? [],
          downloads: raw.downloads ?? {},
        });
      }
      // Drop download entries whose files were deleted outside the app.
      const dl = { ...get().downloads };
      let changed = false;
      for (const [id, d] of Object.entries(dl)) {
        if (!(await api.fileExists(d.path))) {
          delete dl[id];
          changed = true;
        }
      }
      if (changed) set({ downloads: dl });
    } catch (e) {
      toast(`Не удалось загрузить библиотеку: ${errText(e)}`, "error");
    } finally {
      set({ loaded: true });
    }
  },

  toggleLike: (t) => {
    const liked = get().likes.some((x) => x.id === t.id);
    set({
      likes: liked ? get().likes.filter((x) => x.id !== t.id) : [t, ...get().likes],
      dislikes: get().dislikes.filter((x) => x !== t.id),
    });
    toast(liked ? "Удалено из «Мне нравится»" : "Добавлено в «Мне нравится»", "success");
  },

  toggleDislike: (t) => {
    const has = get().dislikes.includes(t.id);
    set({
      dislikes: has ? get().dislikes.filter((x) => x !== t.id) : [...get().dislikes, t.id],
      likes: has ? get().likes : get().likes.filter((x) => x.id !== t.id),
    });
    if (!has) toast("Больше не будем советовать этот трек в волне");
  },

  createPlaylist: (name, tracks = [], origin) => {
    const id = uid();
    set({ playlists: [...get().playlists, { id, name: name.trim() || "Новый плейлист", tracks, createdAt: Date.now(), origin }] });
    return id;
  },

  renamePlaylist: (id, name) =>
    set({ playlists: get().playlists.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)) }),

  deletePlaylist: (id) => {
    set({ playlists: get().playlists.filter((p) => p.id !== id) });
    const r = useUi.getState().route;
    if (r.name === "playlist" && r.id === id) useUi.getState().go({ name: "playlists" });
  },

  addToPlaylist: (id, tracks) => {
    let added = 0;
    set({
      playlists: get().playlists.map((p) => {
        if (p.id !== id) return p;
        const have = new Set(p.tracks.map((t) => t.id));
        const fresh = tracks.filter((t) => !have.has(t.id));
        added = fresh.length;
        return { ...p, tracks: [...p.tracks, ...fresh] };
      }),
    });
    return added;
  },

  removeFromPlaylist: (id, index) =>
    set({
      playlists: get().playlists.map((p) =>
        p.id === id ? { ...p, tracks: p.tracks.filter((_, i) => i !== index) } : p,
      ),
    }),

  moveInPlaylist: (id, from, to) =>
    set({
      playlists: get().playlists.map((p) => {
        if (p.id !== id || to < 0 || to >= p.tracks.length) return p;
        const tracks = p.tracks.slice();
        const [x] = tracks.splice(from, 1);
        tracks.splice(to, 0, x);
        return { ...p, tracks };
      }),
    }),

  pushHistory: (t) => {
    const h = get().history.filter((e) => e.track.id !== t.id);
    set({ history: [{ track: t, at: Date.now() }, ...h].slice(0, MAX_HISTORY) });
  },

  clearHistory: () => set({ history: [] }),

  download: async (tracks) => {
    let dir = useSettings.getState().downloadDir;
    if (!dir) {
      dir = await api.defaultDownloadDir();
      useSettings.getState().set({ downloadDir: dir });
    }
    const ui = useUi.getState();
    const todo = tracks.filter((t) => !get().downloads[t.id] && !(t.id in ui.downloading));
    if (!todo.length) {
      toast("Уже скачано");
      return;
    }
    if (todo.length > 1) toast(`Скачиваю ${todo.length} треков…`);
    for (const t of todo) {
      ui.setDownloading(t.id, 0);
      try {
        const path = await api.downloadTrack(t, dir);
        set({ downloads: { ...get().downloads, [t.id]: { path, track: t, at: Date.now() } } });
        if (todo.length === 1) toast(`Сохранено: ${t.artist} — ${t.title}`, "success");
      } catch (e) {
        toast(`${t.title}: ${errText(e)}`, "error");
      } finally {
        useUi.getState().setDownloading(t.id, null);
      }
    }
    if (todo.length > 1) toast("Загрузка завершена", "success");
  },

  removeDownload: async (id, deleteFile) => {
    const d = get().downloads[id];
    if (!d) return;
    if (deleteFile) {
      try {
        await api.deleteFile(d.path);
      } catch (e) {
        toast(errText(e), "error");
      }
    }
    const next = { ...get().downloads };
    delete next[id];
    set({ downloads: next });
  },
}));

// Persist to disk (debounced) after the first load.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useLibrary.subscribe((s, prev) => {
  if (!s.loaded || !prev.loaded) return;
  if (
    s.likes === prev.likes &&
    s.dislikes === prev.dislikes &&
    s.playlists === prev.playlists &&
    s.history === prev.history &&
    s.downloads === prev.downloads
  )
    return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { likes, dislikes, playlists, history, downloads } = useLibrary.getState();
    api.librarySave({ likes, dislikes, playlists, history, downloads }).catch((e) => toast(errText(e), "error"));
  }, 600);
});
