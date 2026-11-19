import { emit, listen } from "@tauri-apps/api/event";
import { api } from "./api";
import { engine } from "./audio";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";
import { useLibrary } from "../store/library";
import { useUi } from "../store/ui";
import type { Track } from "./types";

export interface MiniState {
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  liked: boolean;
}

export type MiniCmd = "toggle" | "next" | "prev" | "like" | { seek: number };

/** Windows media overlay + media keys via the Media Session API. */
function mediaSession() {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const p = () => usePlayer.getState();
  ms.setActionHandler("play", () => p().toggle());
  ms.setActionHandler("pause", () => p().toggle());
  ms.setActionHandler("nexttrack", () => p().next());
  ms.setActionHandler("previoustrack", () => p().prev());
  ms.setActionHandler("seekto", (d) => d.seekTime != null && p().seek(d.seekTime));
  let lastId = "";
  usePlayer.subscribe((s) => {
    const t = s.current();
    if (t && t.id !== lastId) {
      lastId = t.id;
      ms.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist,
        album: t.album ?? "",
        artwork: t.cover ? [{ src: t.cover, sizes: "512x512" }] : [],
      });
    }
    ms.playbackState = s.playing ? "playing" : "paused";
  });
}

function discordPresence() {
  let lastKey = "";
  const push = () => {
    const { enabled, clientId } = useSettings.getState().discord;
    const s = usePlayer.getState();
    const t = s.current();
    if (!enabled || !clientId) return;
    if (!t) {
      api.discordClear().catch(() => {});
      return;
    }
    const key = `${t.id}|${s.playing}|${Math.round(s.position / 10)}`;
    if (key === lastKey) return;
    lastKey = key;
    api
      .discordSet({
        clientId,
        title: t.title,
        artist: t.artist,
        cover: t.cover,
        link: t.link,
        startedAt: Math.floor(Date.now() / 1000 - s.position),
        paused: !s.playing,
      })
      .catch(() => {});
  };
  usePlayer.subscribe((s, p) => {
    if (s.index !== p.index || s.playing !== p.playing || s.queue !== p.queue || Math.abs(s.position - p.position) > 5) push();
  });
  useSettings.subscribe((s, p) => {
    if (s.discord !== p.discord) {
      lastKey = "";
      if (!s.discord.enabled) api.discordClear().catch(() => {});
      else push();
    }
  });
}

function miniplayerSync() {
  const send = () => {
    const s = usePlayer.getState();
    const t = s.current();
    const state: MiniState = {
      track: t,
      playing: s.playing,
      position: s.position,
      duration: s.duration,
      liked: !!t && useLibrary.getState().likes.some((x) => x.id === t.id),
    };
    emit("mini:state", state).catch(() => {});
  };
  usePlayer.subscribe(send);
  useLibrary.subscribe((s, p) => s.likes !== p.likes && send());
  listen("mini:ready", send);
  listen<MiniCmd>("mini:cmd", ({ payload }) => {
    const p = usePlayer.getState();
    if (payload === "toggle") p.toggle();
    else if (payload === "next") p.next();
    else if (payload === "prev") p.prev();
    else if (payload === "like") {
      const t = p.current();
      if (t) useLibrary.getState().toggleLike(t);
    } else if (typeof payload === "object") p.seek(payload.seek);
  });
}

function keyboard() {
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable]")) return;
    const p = usePlayer.getState();
    const st = useSettings.getState();
    if (e.code === "Space") {
      e.preventDefault();
      p.toggle();
    } else if (e.code === "ArrowRight" && e.ctrlKey) p.next();
    else if (e.code === "ArrowLeft" && e.ctrlKey) p.prev();
    else if (e.code === "ArrowRight") p.seek(Math.min(p.duration, engine.el.currentTime + 5));
    else if (e.code === "ArrowLeft") p.seek(Math.max(0, engine.el.currentTime - 5));
    else if (e.code === "ArrowUp") st.set({ volume: Math.min(1, st.volume + 0.05) });
    else if (e.code === "ArrowDown") st.set({ volume: Math.max(0, st.volume - 0.05) });
    else if (e.code === "KeyM") st.set({ muted: !st.muted });
    else if (e.code === "KeyL") {
      const t = p.current();
      if (t) useLibrary.getState().toggleLike(t);
    } else if (e.code === "KeyF" && e.ctrlKey) {
      e.preventDefault();
      useUi.getState().go({ name: "search" });
      setTimeout(() => document.querySelector<HTMLInputElement>("#global-search")?.focus(), 30);
    }
  });
}

function downloadProgress() {
  listen<{ id: string; progress: number }>("download-progress", ({ payload }) => {
    if (payload.id in useUi.getState().downloading) useUi.getState().setDownloading(payload.id, payload.progress);
  });
}

export function initIntegrations() {
  mediaSession();
  discordPresence();
  miniplayerSync();
  keyboard();
  downloadProgress();
}
