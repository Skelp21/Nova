export type Source = "youtube" | "soundcloud" | "vk" | "yandex";

export interface Track {
  id: string;
  source: Source;
  sourceId: string;
  title: string;
  artist: string;
  album?: string | null;
  duration: number;
  cover?: string | null;
  link?: string | null;
  unavailable?: boolean;
}

export interface StreamInfo {
  url: string;
  kind: "progressive" | "hls";
}

export interface Lyrics {
  synced?: string | null;
  plain?: string | null;
}

export interface ImportedPlaylist {
  name: string;
  items: { title: string; artist: string; duration: number }[];
}

export interface AccountsStatus {
  vk: boolean;
  vkUserId?: string | null;
  yandex: boolean;
  yandexLogin?: string | null;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  tracks: Track[];
  createdAt: number;
  /** Where it came from, for display. */
  origin?: string;
}

export interface HistoryEntry {
  track: Track;
  at: number;
}

export interface DownloadEntry {
  path: string;
  track: Track;
  at: number;
}

export const SOURCES: { id: Source; name: string; color: string; needsAuth: boolean }[] = [
  { id: "youtube", name: "YouTube Music", color: "#ff3b3b", needsAuth: false },
  { id: "soundcloud", name: "SoundCloud", color: "#ff7a1a", needsAuth: false },
  { id: "vk", name: "VK Музыка", color: "#2f81f7", needsAuth: true },
  { id: "yandex", name: "Яндекс Музыка", color: "#ffcc00", needsAuth: true },
];

export const sourceName = (s: Source) => SOURCES.find((x) => x.id === s)?.name ?? s;
