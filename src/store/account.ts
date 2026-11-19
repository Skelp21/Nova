import { create } from "zustand";
import * as cloud from "../lib/cloud";
import { errText } from "../lib/api";
import type { HistoryEntry, Playlist, Track } from "../lib/types";
import { useLibrary } from "./library";
import { toast } from "./ui";

/** Part of the library that follows the account (downloads stay per device). */
export interface SyncedLibrary {
  likes: Track[];
  dislikes: string[];
  playlists: Playlist[];
  history: HistoryEntry[];
}

type Status = "off" | "syncing" | "synced" | "error";

interface AccountState {
  session: cloud.Session | null;
  status: Status;
  error: string | null;
  lastSyncAt: number | null;
  login: (email: string, password: string, register: boolean) => Promise<boolean>;
  logout: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const SESSION_KEY = "nota-session";
const REMOTE_KEY = "nota-remote-updated";

function loadSession(): cloud.Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(s: cloud.Session | null) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
}

export const useAccount = create<AccountState>((set, get) => ({
  session: loadSession(),
  status: loadSession() ? "synced" : "off",
  error: null,
  lastSyncAt: null,

  login: async (email, password, register) => {
    try {
      const s = register ? await cloud.signUp(email, password) : await cloud.signIn(email, password);
      if (!s) {
        toast("Аккаунт создан. Подтвердите почту по ссылке из письма и войдите.", "success");
        return false;
      }
      saveSession(s);
      localStorage.removeItem(REMOTE_KEY);
      set({ session: s, error: null });
      await fullSync(true);
      toast(register ? "Аккаунт создан — плейлисты сохраняются в облаке" : `Вы вошли как ${s.email}`, "success");
      return true;
    } catch (e) {
      toast(errText(e), "error");
      return false;
    }
  },

  logout: async () => {
    const s = get().session;
    if (s) await cloud.signOut(s);
    saveSession(null);
    localStorage.removeItem(REMOTE_KEY);
    set({ session: null, status: "off", error: null });
    toast("Вы вышли. Библиотека осталась на этом устройстве.");
  },

  syncNow: () => fullSync(false),
}));

// ---------------- sync engine ----------------

let applyingRemote = false;
let dirty = false;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let busy: Promise<void> | null = null;

async function session(): Promise<cloud.Session | null> {
  let s = useAccount.getState().session;
  if (!s) return null;
  if (s.expiresAt - Date.now() / 1000 < 120) {
    try {
      s = await cloud.refresh(s);
      saveSession(s);
      useAccount.setState({ session: s });
    } catch (e) {
      saveSession(null);
      useAccount.setState({ session: null, status: "off", error: errText(e) });
      toast(errText(e), "error");
      return null;
    }
  }
  return s;
}

function snapshot(): SyncedLibrary {
  const { likes, dislikes, playlists, history } = useLibrary.getState();
  return { likes, dislikes, playlists, history: history.slice(0, 200) };
}

function apply(data: SyncedLibrary) {
  applyingRemote = true;
  useLibrary.setState({
    likes: data.likes ?? [],
    dislikes: data.dislikes ?? [],
    playlists: data.playlists ?? [],
    history: data.history ?? [],
  });
  applyingRemote = false;
}

function uniqBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Union of both sides: nothing gets lost when two devices meet for the first time. */
export function mergeLibraries(a: SyncedLibrary, b: SyncedLibrary): SyncedLibrary {
  const byId = new Map<string, Playlist>();
  for (const p of [...(a.playlists ?? []), ...(b.playlists ?? [])]) {
    const prev = byId.get(p.id);
    byId.set(p.id, prev ? { ...prev, tracks: uniqBy([...prev.tracks, ...p.tracks], (t) => t.id) } : p);
  }
  return {
    likes: uniqBy([...(a.likes ?? []), ...(b.likes ?? [])], (t) => t.id),
    dislikes: [...new Set([...(a.dislikes ?? []), ...(b.dislikes ?? [])])],
    playlists: [...byId.values()],
    history: uniqBy([...(a.history ?? []), ...(b.history ?? [])].sort((x, y) => y.at - x.at), (h) => h.track.id).slice(0, 200),
  };
}

async function push(s: cloud.Session) {
  const updated = await cloud.pushLibrary(s, snapshot());
  localStorage.setItem(REMOTE_KEY, updated);
  dirty = false;
}

/** Pull, reconcile, push. `firstLogin` merges instead of trusting either side. */
async function fullSync(firstLogin: boolean): Promise<void> {
  if (busy) return busy;
  busy = (async () => {
    const s = await session();
    if (!s) return;
    useAccount.setState({ status: "syncing" });
    try {
      const remote = await cloud.pullLibrary(s);
      const known = localStorage.getItem(REMOTE_KEY);
      if (!remote) {
        await push(s);
      } else if (firstLogin) {
        apply(mergeLibraries(snapshot(), remote.data as SyncedLibrary));
        await push(s);
      } else if (remote.updatedAt !== known) {
        // Another device changed it.
        if (dirty) {
          apply(mergeLibraries(snapshot(), remote.data as SyncedLibrary));
          await push(s);
        } else {
          apply(remote.data as SyncedLibrary);
          localStorage.setItem(REMOTE_KEY, remote.updatedAt);
        }
      } else if (dirty) {
        await push(s);
      }
      useAccount.setState({ status: "synced", error: null, lastSyncAt: Date.now() });
    } catch (e) {
      useAccount.setState({ status: "error", error: errText(e) });
    }
  })();
  try {
    await busy;
  } finally {
    busy = null;
  }
}

/** Starts background sync. Call once after the library is loaded. */
export function initSync() {
  useLibrary.subscribe((n, p) => {
    if (applyingRemote || !n.loaded || !p.loaded) return;
    if (n.likes === p.likes && n.dislikes === p.dislikes && n.playlists === p.playlists && n.history === p.history) return;
    dirty = true;
    if (!useAccount.getState().session) return;
    clearTimeout(pushTimer);
    // History changes on every track: batch them more lazily than edits.
    const onlyHistory = n.likes === p.likes && n.dislikes === p.dislikes && n.playlists === p.playlists;
    pushTimer = setTimeout(() => fullSync(false), onlyHistory ? 30000 : 1500);
  });

  let lastPull = 0;
  const pull = () => {
    if (!useAccount.getState().session || Date.now() - lastPull < 15000) return;
    lastPull = Date.now();
    fullSync(false);
  };
  window.addEventListener("focus", pull);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && pull());
  setInterval(() => document.visibilityState === "visible" && pull(), 60000);
  pull();
}
