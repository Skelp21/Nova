import { api, errText } from "./api";
import { normKey } from "./format";
import { best } from "./importer";
import type { ImportedPlaylist, LinkKind, Playlist, PlaylistLink, Source, Track } from "./types";
import { useLibrary } from "../store/library";
import { useSettings } from "../store/settings";
import { toast } from "../store/ui";

export const LINK_NAMES: Record<LinkKind, string> = {
  spotify: "Spotify",
  apple: "Apple Music",
  soundcloud: "SoundCloud",
  vk: "ВКонтакте",
  yandex: "Яндекс Музыка",
};

/** Auto-update interval for playlists with auto mode on. */
const AUTO_EVERY_MS = 6 * 60 * 60 * 1000;

export function detectKind(url: string): LinkKind | null {
  if (/open\.spotify\.com|spotify:/.test(url)) return "spotify";
  if (/music\.apple\.com/.test(url)) return "apple";
  if (/soundcloud\.com/.test(url)) return "soundcloud";
  return null;
}

export const itemKey = (artist: string, title: string) => normKey(artist, title);

/** Builds the link stored with a freshly imported Spotify / Apple Music playlist. */
export function linkFromMatch(kind: "spotify" | "apple", url: string, source: Source, pl: ImportedPlaylist, results: (Track | null)[]): PlaylistLink {
  const keys: Record<string, string> = {};
  pl.items.forEach((it, i) => {
    const t = results[i];
    if (t) keys[itemKey(it.artist, it.title)] = t.id;
  });
  return { kind, url, matchSource: source, keys, auto: false, updatedAt: Date.now() };
}

/** Link for sources whose tracks are imported as-is (SoundCloud / VK / Yandex). */
export function linkFromTracks(kind: "soundcloud" | "vk" | "yandex", tracks: Track[], url?: string): PlaylistLink {
  const keys: Record<string, string> = {};
  for (const t of tracks) keys[t.id] = t.id;
  return { kind, url, keys, auto: false, updatedAt: Date.now() };
}

async function matchMissing(items: ImportedPlaylist["items"], source: Source): Promise<(Track | null)[]> {
  const out: (Track | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = best(items[i], await api.search(source, `${items[i].artist} ${items[i].title}`, 6));
      } catch {
        out[i] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
}

const running = new Set<string>();

/**
 * Re-reads the source and rebuilds the playlist in source order.
 * Already matched tracks are reused (no new search), new ones are matched,
 * removed ones dropped. Tracks the user added by hand stay at the end.
 */
export async function refreshPlaylist(id: string, silent = false): Promise<{ added: number; removed: number } | null> {
  if (running.has(id)) return null;
  const pl = useLibrary.getState().playlists.find((p) => p.id === id);
  if (!pl?.link) return null;
  running.add(id);
  const link = pl.link;
  try {
    const oldKeys = link.keys ?? {};
    const linkedIds = new Set(Object.values(oldKeys));
    const byId = new Map(pl.tracks.map((t) => [t.id, t]));
    const manual = pl.tracks.filter((t) => !linkedIds.has(t.id));

    let fresh: Track[] = [];
    const keys: Record<string, string> = {};

    if (link.kind === "spotify" || link.kind === "apple") {
      if (!link.url) throw new Error("нет ссылки на плейлист");
      const src = link.kind === "spotify" ? await api.spotifyImport(link.url) : await api.appleImport(link.url);
      const source = link.matchSource ?? useSettings.getState().importSource;
      const slots: (Track | null)[] = src.items.map((it) => {
        const prevId = oldKeys[itemKey(it.artist, it.title)];
        return (prevId && byId.get(prevId)) || null;
      });
      const todo = src.items.map((it, i) => ({ it, i })).filter(({ i }) => !slots[i]);
      if (todo.length) {
        const found = await matchMissing(todo.map((x) => x.it), source);
        todo.forEach(({ i }, k) => (slots[i] = found[k]));
      }
      src.items.forEach((it, i) => {
        const t = slots[i];
        if (t) {
          keys[itemKey(it.artist, it.title)] = t.id;
          fresh.push(t);
        }
      });
    } else {
      fresh =
        link.kind === "soundcloud"
          ? (await api.soundcloudImport(link.url ?? "")).tracks
          : link.kind === "vk"
            ? await api.vkMyAudio()
            : await api.yandexLikes();
      for (const t of fresh) keys[t.id] = t.id;
    }

    // Keep each track once; hand-added tracks after the source ones.
    const seen = new Set<string>();
    const tracks = [...fresh, ...manual].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    const before = new Set(pl.tracks.map((t) => t.id));
    const after = new Set(tracks.map((t) => t.id));
    const added = tracks.filter((t) => !before.has(t.id)).length;
    const removed = pl.tracks.filter((t) => !after.has(t.id)).length;

    // The playlist may have changed while we were fetching: re-read it.
    const cur = useLibrary.getState().playlists.find((p) => p.id === id);
    if (!cur) return null;
    useLibrary.getState().updatePlaylist(id, {
      tracks: added || removed ? tracks : cur.tracks,
      link: { ...(cur.link ?? link), keys, updatedAt: Date.now() },
    });
    if (!silent || added || removed) {
      toast(
        added || removed
          ? `«${pl.name}»: ${added ? `+${added}` : ""}${added && removed ? ", " : ""}${removed ? `−${removed}` : ""} треков`
          : `«${pl.name}» уже актуален`,
        "success",
      );
    }
    return { added, removed };
  } catch (e) {
    if (!silent) toast(`Не удалось обновить «${pl.name}»: ${errText(e)}`, "error");
    return null;
  } finally {
    running.delete(id);
  }
}

/** Attaches a source link to a playlist that was created without one. */
export function attachLink(pl: Playlist, url: string): PlaylistLink | null {
  const kind = detectKind(url.trim());
  if (!kind) return null;
  // Treat the current tracks as already matched, so nothing is searched twice.
  const keys: Record<string, string> = {};
  for (const t of pl.tracks) keys[kind === "soundcloud" ? t.id : itemKey(t.artist, t.title)] = t.id;
  const link: PlaylistLink = {
    kind,
    url: url.trim(),
    matchSource: pl.tracks[0]?.source ?? useSettings.getState().importSource,
    keys,
    auto: false,
  };
  useLibrary.getState().updatePlaylist(pl.id, { link, origin: pl.origin ?? LINK_NAMES[kind] });
  return link;
}

/** Background auto-update: on start and every 30 min checks who is due. */
export function initAutoRefresh() {
  const tick = async () => {
    const due = useLibrary
      .getState()
      .playlists.filter((p) => p.link?.auto && Date.now() - (p.link.updatedAt ?? 0) > AUTO_EVERY_MS);
    for (const p of due) await refreshPlaylist(p.id, true);
  };
  setTimeout(tick, 15000);
  setInterval(tick, 30 * 60 * 1000);
}
