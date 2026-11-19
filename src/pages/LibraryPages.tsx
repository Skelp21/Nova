import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ChevronRight, Download, FolderOpen, Heart, History, Import, Pencil, Plus, Trash2 } from "lucide-react";
import { AccountCard } from "../components/AccountCard";
import { useAccount } from "../store/account";
import { Mosaic } from "../components/Cover";
import type { ReactNode } from "react";
import { isMobile } from "../lib/platform";
import { useLibrary } from "../store/library";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";
import { Collection } from "./Collection";

export function LikedPage() {
  const likes = useLibrary((s) => s.likes);
  return (
    <Collection
      kicker="Коллекция"
      title="Мне нравится"
      tracks={likes}
      context="Мне нравится"
      cover={
        <div className="liked-cover">
          <Heart size={72} fill="currentColor" />
        </div>
      }
      emptyText="Нажимайте ♥ у треков — они появятся здесь"
    />
  );
}

export function HistoryPage() {
  const history = useLibrary((s) => s.history);
  return (
    <Collection
      kicker="Коллекция"
      title="История"
      tracks={history.map((h) => h.track)}
      context="История"
      actions={
        history.length > 0 && (
          <button className="btn ghost" onClick={() => useLibrary.getState().clearHistory()}>
            <Trash2 size={15} /> Очистить
          </button>
        )
      }
      emptyText="Здесь будут треки, которые вы слушали"
    />
  );
}

export function DownloadsPage() {
  const downloads = useLibrary((s) => s.downloads);
  const dir = useSettings((s) => s.downloadDir);
  const list = Object.values(downloads).sort((a, b) => b.at - a.at);
  return (
    <Collection
      kicker="Офлайн"
      title="Загрузки"
      tracks={list.map((d) => d.track)}
      context="Загрузки"
      subtitle={dir || undefined}
      actions={
        list.length > 0 && !isMobile && (
          <button className="btn ghost" onClick={() => revealItemInDir(list[0].path)}>
            <FolderOpen size={15} /> Папка
          </button>
        )
      }
      emptyText="Скачанные треки играют без интернета. Скачать можно из меню трека или кнопкой в плеере."
    />
  );
}

export function PlaylistsPage({ embedded }: { embedded?: boolean } = {}) {
  const playlists = useLibrary((s) => s.playlists);
  const { go, openModal } = useUi.getState();
  return (
    <div className={embedded ? "" : "page"}>
      <div className="page-head">
        {embedded ? <h2>Плейлисты</h2> : <h1>Плейлисты</h1>}
        <div className="row gap">
          <button className="btn ghost" onClick={() => openModal({ type: "import" })}>
            <Import size={16} /> Импорт
          </button>
          <button className="btn primary" onClick={() => openModal({ type: "createPlaylist" })}>
            <Plus size={16} /> Создать
          </button>
        </div>
      </div>
      <div className="card-grid">
        {playlists.map((p) => (
          <button key={p.id} className="card" onClick={() => go({ name: "playlist", id: p.id })}>
            <Mosaic covers={p.tracks.map((t) => t.cover)} size={170} />
            <div className="card-title ellipsis">{p.name}</div>
            <div className="muted small">
              {p.tracks.length} тр.{p.origin ? ` · из ${p.origin}` : ""}
            </div>
          </button>
        ))}
      </div>
      {!playlists.length && <div className="empty">Плейлистов пока нет. Создайте свой или перенесите из Spotify, Apple Music, SoundCloud, ВК или Яндекс Музыки.</div>}
    </div>
  );
}

export function PlaylistPage({ id }: { id: string }) {
  const pl = useLibrary((s) => s.playlists.find((p) => p.id === id));
  const openModal = useUi((s) => s.openModal);
  if (!pl) return <div className="empty">Плейлист не найден</div>;
  return (
    <Collection
      kicker={pl.origin ? `Плейлист · из ${pl.origin}` : "Плейлист"}
      title={pl.name}
      tracks={pl.tracks}
      context={pl.name}
      playlistId={pl.id}
      actions={
        <>
          <button className="icon-btn" title="Переименовать" onClick={() => openModal({ type: "renamePlaylist", id: pl.id })}>
            <Pencil size={17} />
          </button>
          <button
            className="icon-btn danger"
            title="Удалить плейлист"
            onClick={() => {
              if (confirmDelete(pl.name)) useLibrary.getState().deletePlaylist(pl.id);
            }}
          >
            <Trash2 size={17} />
          </button>
        </>
      }
      emptyText="Добавляйте треки через меню «…» → «Добавить в плейлист»"
    />
  );
}

let armed: { name: string; at: number } | null = null;
/** Two clicks within 3 s delete the playlist (no blocking dialogs). */
function confirmDelete(name: string): boolean {
  const now = Date.now();
  if (armed && armed.name === name && now - armed.at < 3000) {
    armed = null;
    return true;
  }
  armed = { name, at: now };
  useUi.getState().toast(`Нажмите ещё раз, чтобы удалить «${name}»`);
  return false;
}

/** Library overview (mobile tab "Медиатека"). */
export function LibraryHub() {
  const likes = useLibrary((s) => s.likes.length);
  const history = useLibrary((s) => s.history.length);
  const downloads = useLibrary((s) => Object.keys(s.downloads).length);
  const session = useAccount((s) => s.session);
  const go = useUi((s) => s.go);
  const row = (icon: ReactNode, label: string, count: number, route: Parameters<typeof go>[0]) => (
    <button className="hub-row" onClick={() => go(route)}>
      <span className="hub-icon">{icon}</span>
      <span className="grow">{label}</span>
      <span className="muted">{count}</span>
      <ChevronRight size={18} className="muted" />
    </button>
  );
  return (
    <div className="page">
      <h1>Медиатека</h1>
      {!session && <AccountCard />}
      <div className="hub">
        {row(<Heart size={20} />, "Мне нравится", likes, { name: "liked" })}
        {row(<History size={20} />, "История", history, { name: "history" })}
        {row(<Download size={20} />, "Загрузки", downloads, { name: "downloads" })}
      </div>
      <PlaylistsPage embedded />
    </div>
  );
}
