import { invoke } from "@tauri-apps/api/core";
import type { AccountsStatus, ImportedPlaylist, Lyrics, Source, StreamInfo, Track } from "./types";

export const api = {
  search: (source: Source, query: string, limit = 30) => invoke<Track[]>("search", { source, query, limit }),
  resolveStream: (track: Track, localPath?: string) =>
    invoke<StreamInfo>("resolve_stream", { track, localPath: localPath ?? null }),
  radio: (track: Track) => invoke<Track[]>("radio", { track }),
  lyrics: (title: string, artist: string, duration: number) => invoke<Lyrics>("lyrics", { title, artist, duration }),

  spotifyImport: (link: string) => invoke<ImportedPlaylist>("spotify_import", { link }),
  appleImport: (link: string) => invoke<ImportedPlaylist>("apple_import", { link }),
  soundcloudImport: (link: string) => invoke<{ name: string; tracks: Track[] }>("soundcloud_import", { link }),
  vkMyAudio: () => invoke<Track[]>("vk_my_audio"),
  yandexLikes: () => invoke<Track[]>("yandex_likes"),

  accountsStatus: () => invoke<AccountsStatus>("accounts_status"),
  authLogin: (provider: "vk" | "yandex") => invoke<void>("auth_login", { provider }),
  authLogout: (provider: "vk" | "yandex") => invoke<void>("auth_logout", { provider }),
  authSetToken: (provider: "vk" | "yandex", token: string) => invoke<void>("auth_set_token", { provider, token }),

  libraryLoad: () => invoke<unknown>("library_load"),
  librarySave: (data: unknown) => invoke<void>("library_save", { data }),

  defaultDownloadDir: () => invoke<string>("default_download_dir"),
  downloadTrack: (track: Track, dir: string) => invoke<string>("download_track", { track, dir }),
  fileExists: (path: string) => invoke<boolean>("file_exists", { path }),
  deleteFile: (path: string) => invoke<void>("delete_file", { path }),

  discordSet: (presence: {
    clientId: string;
    title: string;
    artist: string;
    cover?: string | null;
    link?: string | null;
    startedAt?: number | null;
    paused: boolean;
  }) => invoke<void>("discord_set", { presence }),
  discordClear: () => invoke<void>("discord_clear"),

  openMiniplayer: () => invoke<void>("open_miniplayer"),
};

export const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));
