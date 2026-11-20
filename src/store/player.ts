import { create } from "zustand";
import { api, errText } from "../lib/api";
import { engine } from "../lib/audio";
import { shuffleArray } from "../lib/format";
import { sourceName, type Source, type Track } from "../lib/types";
import { best } from "../lib/importer";
import { useLibrary } from "./library";
import { useSettings } from "./settings";
import { toast } from "./ui";

export type Repeat = "off" | "all" | "one";

interface PlayerState {
  queue: Track[];
  index: number;
  /** Order before shuffle was enabled, to restore it. */
  unshuffled: Track[] | null;
  context: string;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  buffered: number;
  repeat: Repeat;
  shuffle: boolean;
  wave: boolean;

  current: () => Track | null;
  playList: (tracks: Track[], start?: number, context?: string) => void;
  playNext: (tracks: Track[]) => void;
  addToQueue: (tracks: Track[]) => void;
  removeAt: (i: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  jumpTo: (i: number) => void;
  toggle: () => void;
  next: (auto?: boolean) => void;
  prev: () => void;
  seek: (t: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  startWave: (seed?: Track) => Promise<void>;
}

let loadToken = 0;
let failStreak = 0;
let extendingWave = false;
/** Tracks we already tried to replace with another service's copy. */
const triedAlt = new Set<string>();
let handlingError = false;
/** A track that hasn't started within this time counts as failed. */
const START_TIMEOUT_MS = 12000;
let startTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * When a track can't be played (blocked stream, removed upload…), look for the
 * same song in another enabled service and play that copy instead of skipping.
 */
async function playAlternative(track: Track): Promise<boolean> {
  if (triedAlt.has(track.id)) return false;
  triedAlt.add(track.id);
  const enabled = useSettings.getState().enabledSources;
  const order: Source[] = ["soundcloud", "youtube", "yandex", "vk"];
  for (const src of order.filter((s) => s !== track.source && enabled[s])) {
    try {
      const found = await api.search(src, `${track.artist} ${track.title}`, 6);
      const alt = best({ title: track.title, artist: track.artist, duration: track.duration }, found);
      if (!alt) continue;
      const st = usePlayer.getState();
      if (st.queue[st.index]?.id !== track.id) return true; // user moved on
      const queue = st.queue.slice();
      queue[st.index] = alt;
      triedAlt.add(alt.id);
      usePlayer.setState({ queue });
      toast(`«${track.title}» играет из ${sourceName(src)}`);
      loadCurrent(true);
      return true;
    } catch {
      /* this service is unavailable (not signed in etc.) — try the next */
    }
  }
  return false;
}

/** Shared failure path: try another service, otherwise report and skip. */
async function onTrackFailed(track: Track, reason: string) {
  if (handlingError) return;
  handlingError = true;
  try {
    usePlayer.setState({ loading: true, playing: false });
    if (await playAlternative(track)) return;
    usePlayer.setState({ loading: false });
    toast(`«${track.title}» не играет: ${reason}`, "error");
    failStreak++;
    if (failStreak < 4) usePlayer.getState().next(false);
    else failStreak = 0;
  } finally {
    handlingError = false;
  }
}

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: -1,
  unshuffled: null,
  context: "",
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  buffered: 0,
  repeat: "off",
  shuffle: false,
  wave: false,

  current: () => get().queue[get().index] ?? null,

  playList: (tracks, start = 0, context = "") => {
    const playable = tracks.filter((t) => !t.unavailable);
    if (!playable.length) {
      toast("Нет доступных треков", "error");
      return;
    }
    const first = tracks[start] && !tracks[start].unavailable ? tracks[start] : playable[0];
    let queue = playable;
    let index = queue.indexOf(first);
    let unshuffled: Track[] | null = null;
    if (get().shuffle) {
      unshuffled = queue;
      queue = [first, ...shuffleArray(queue.filter((t) => t !== first))];
      index = 0;
    }
    set({ queue, index, unshuffled, context, wave: false });
    loadCurrent(true);
  },

  playNext: (tracks) => {
    const { queue, index } = get();
    if (index < 0) return get().playList(tracks);
    const q = queue.slice();
    q.splice(index + 1, 0, ...tracks);
    set({ queue: q });
    toast(tracks.length > 1 ? `${tracks.length} треков сыграют следующими` : "Сыграет следующим");
  },

  addToQueue: (tracks) => {
    if (get().index < 0) return get().playList(tracks);
    set({ queue: [...get().queue, ...tracks] });
    toast(tracks.length > 1 ? `В очередь: ${tracks.length} треков` : "Добавлено в очередь");
  },

  removeAt: (i) => {
    const { queue, index } = get();
    if (i === index) return;
    set({ queue: queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index });
  },

  moveInQueue: (from, to) => {
    const { queue, index } = get();
    if (to < 0 || to >= queue.length) return;
    const q = queue.slice();
    const [x] = q.splice(from, 1);
    q.splice(to, 0, x);
    let ni = index;
    if (from === index) ni = to;
    else if (from < index && to >= index) ni--;
    else if (from > index && to <= index) ni++;
    set({ queue: q, index: ni });
  },

  clearQueue: () => {
    const cur = get().current();
    set({ queue: cur ? [cur] : [], index: cur ? 0 : -1, unshuffled: null, wave: false });
  },

  jumpTo: (i) => {
    if (i < 0 || i >= get().queue.length) return;
    set({ index: i });
    loadCurrent(true);
  },

  toggle: () => {
    if (get().index < 0) return;
    if (engine.el.paused) {
      if (!engine.el.src && !get().loading) return loadCurrent(true, get().position);
      engine.play().catch((e) => toast(errText(e), "error"));
    } else engine.pause();
  },

  next: (auto = false) => {
    const { queue, index, repeat } = get();
    if (auto && repeat === "one") {
      engine.seek(0);
      engine.play().catch(() => {});
      return;
    }
    if (index + 1 < queue.length) {
      set({ index: index + 1 });
      loadCurrent(true);
    } else if (repeat === "all" && queue.length) {
      set({ index: 0 });
      loadCurrent(true);
    } else if (auto) {
      engine.pause();
      engine.seek(0);
    }
    maybeExtendWave();
  },

  prev: () => {
    const { index } = get();
    if (engine.el.currentTime > 4 || index <= 0) {
      engine.seek(0);
      return;
    }
    set({ index: index - 1 });
    loadCurrent(true);
  },

  seek: (t) => {
    engine.seek(t);
    set({ position: t });
  },

  toggleShuffle: () => {
    const { shuffle, queue, index, unshuffled } = get();
    const cur = queue[index];
    if (!shuffle) {
      const rest = shuffleArray(queue.filter((_, i) => i !== index));
      set({ shuffle: true, unshuffled: queue, queue: cur ? [cur, ...rest] : rest, index: cur ? 0 : -1 });
    } else {
      const base = unshuffled ?? queue;
      // Keep tracks added after shuffling.
      const extra = queue.filter((t) => !base.includes(t));
      const restored = [...base, ...extra];
      set({ shuffle: false, unshuffled: null, queue: restored, index: cur ? restored.indexOf(cur) : -1 });
    }
  },

  cycleRepeat: () => {
    const order: Repeat[] = ["off", "all", "one"];
    set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3] });
  },

  startWave: async (seed) => {
    const lib = useLibrary.getState();
    let s = seed;
    if (!s) {
      const pool = [...lib.likes.slice(0, 50), ...lib.history.slice(0, 30).map((h) => h.track)];
      s = pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
    }
    try {
      if (!s) {
        const found = await api.search("youtube", "хиты 2026", 5);
        s = found[Math.floor(Math.random() * found.length)];
        if (!s) throw new Error("не удалось подобрать треки");
      }
      toast(seed ? `Волна по треку «${s.title}»` : "Запускаю «Мою волну»");
      const list = filterWave(await api.radio(s));
      const queue = seed ? [seed, ...list] : list;
      if (!queue.length) throw new Error("волна пустая");
      set({ queue, index: 0, unshuffled: null, shuffle: false, context: "Моя волна", wave: true });
      loadCurrent(true);
    } catch (e) {
      toast(`Волна: ${errText(e)}`, "error");
    }
  },
}));

function filterWave(list: Track[]): Track[] {
  const { dislikes } = useLibrary.getState();
  const skip = useSettings.getState().waveSkipDisliked ? new Set(dislikes) : new Set<string>();
  const inQueue = new Set(usePlayer.getState().queue.map((t) => t.id));
  return list.filter((t) => !skip.has(t.id) && !inQueue.has(t.id));
}

async function maybeExtendWave() {
  const { wave, queue, index } = usePlayer.getState();
  if (!wave || extendingWave || index < queue.length - 3) return;
  const seed = queue[queue.length - 1];
  if (!seed) return;
  extendingWave = true;
  try {
    const more = filterWave(await api.radio(seed));
    if (more.length) usePlayer.setState({ queue: [...usePlayer.getState().queue, ...more] });
  } catch {
    /* try again on next track */
  } finally {
    extendingWave = false;
  }
}

async function loadCurrent(autoplay: boolean, startAt = 0) {
  const track = usePlayer.getState().current();
  if (!track) return;
  const token = ++loadToken;
  usePlayer.setState({ loading: true, position: startAt, duration: track.duration, buffered: 0 });
  engine.pause();
  try {
    const local = useLibrary.getState().downloads[track.id]?.path;
    const stream = await api.resolveStream(track, local);
    if (token !== loadToken) return; // user switched track meanwhile
    engine.load(stream);
    if (startAt > 0) engine.seek(startAt);
    // Phones often just hang on a blocked stream without any error event.
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      const st = usePlayer.getState();
      if (token !== loadToken || st.playing || engine.el.currentTime > 0) return;
      if (engine.el.paused && !st.loading) return; // waiting for the user to press play
      engine.stop();
      onTrackFailed(track, "не загрузился за 12 секунд");
    }, START_TIMEOUT_MS);
    if (autoplay) await engine.play();
    useLibrary.getState().pushHistory(track);
    failStreak = 0;
  } catch (e) {
    if (token !== loadToken) return;
    // NotAllowedError = autoplay blocked: just wait for the user to press play.
    if (e instanceof DOMException && e.name === "NotAllowedError") {
      usePlayer.setState({ loading: false, playing: false });
      return;
    }
    // The media element's own "error" event handles load failures.
    if (e instanceof DOMException && (e.name === "NotSupportedError" || e.name === "AbortError")) return;
    await onTrackFailed(track, errText(e));
  }
  maybeExtendWave();
}

/** Wires the audio element to the store. Call once in the main window. */
export function bindEngine() {
  const el = engine.el;
  const s = useSettings.getState();
  engine.setVolume(s.volume, s.muted);
  engine.setRate(s.rate);
  engine.setEq(s.eq);
  useSettings.subscribe((n, p) => {
    if (n.volume !== p.volume || n.muted !== p.muted) engine.setVolume(n.volume, n.muted);
    if (n.rate !== p.rate) engine.setRate(n.rate);
    if (n.eq !== p.eq) engine.setEq(n.eq);
  });

  let lastPos = 0;
  el.addEventListener("timeupdate", () => {
    const t = el.currentTime;
    if (Math.abs(t - lastPos) >= 0.25) {
      lastPos = t;
      usePlayer.setState({ position: t });
    }
  });
  el.addEventListener("durationchange", () => {
    if (isFinite(el.duration) && el.duration > 0) usePlayer.setState({ duration: el.duration });
  });
  el.addEventListener("progress", () => {
    if (el.buffered.length) usePlayer.setState({ buffered: el.buffered.end(el.buffered.length - 1) });
  });
  el.addEventListener("play", () => usePlayer.setState({ playing: true }));
  el.addEventListener("pause", () => usePlayer.setState({ playing: false }));
  el.addEventListener("waiting", () => usePlayer.setState({ loading: true }));
  el.addEventListener("playing", () => {
    clearTimeout(startTimer);
    failStreak = 0;
    usePlayer.setState({ loading: false, playing: true });
  });
  el.addEventListener("canplay", () => usePlayer.setState({ loading: false }));
  el.addEventListener("ended", () => usePlayer.getState().next(true));
  el.addEventListener("error", () => {
    const t = usePlayer.getState().current();
    if (!t || !el.src) return;
    onTrackFailed(t, "поток не загрузился");
  });
}
