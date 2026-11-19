import { Download, Heart, History, Home, ListMusic, Plus, Search, Settings, Waves } from "lucide-react";
import type { ReactNode } from "react";
import { useLibrary } from "../store/library";
import { useAccount } from "../store/account";
import { Cloud, CloudOff } from "lucide-react";
import { usePlayer } from "../store/player";
import { useUi, type Route } from "../store/ui";
import { Mosaic } from "./Cover";

function Item({ icon, label, route, count }: { icon: ReactNode; label: string; route: Route; count?: number }) {
  const cur = useUi((s) => s.route);
  const go = useUi((s) => s.go);
  const active = cur.name === route.name && (route.name !== "playlist" || (cur.name === "playlist" && cur.id === route.id));
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={() => go(route)}>
      {icon}
      <span className="grow ellipsis">{label}</span>
      {count !== undefined && count > 0 && <span className="muted small">{count}</span>}
    </button>
  );
}

export function Sidebar() {
  const playlists = useLibrary((s) => s.playlists);
  const likes = useLibrary((s) => s.likes.length);
  const downloads = useLibrary((s) => Object.keys(s.downloads).length);
  const wave = usePlayer((s) => s.wave);
  const playing = usePlayer((s) => s.playing);
  const openModal = useUi((s) => s.openModal);
  const route = useUi((s) => s.route);
  const go = useUi((s) => s.go);

  return (
    <aside className="sidebar">
      <div className="brand" data-tauri-drag-region>
        <img src="/logo.svg" width={26} height={26} />
        <span>Nota</span>
      </div>

      <nav className="nav-group">
        <Item icon={<Home size={18} />} label="Главная" route={{ name: "home" }} />
        <Item icon={<Search size={18} />} label="Поиск" route={{ name: "search" }} />
        <button className={`nav-item wave-item ${wave && playing ? "pulsing" : ""}`} onClick={() => usePlayer.getState().startWave()}>
          <Waves size={18} />
          <span className="grow">Моя волна</span>
        </button>
      </nav>

      <div className="nav-title">Библиотека</div>
      <nav className="nav-group">
        <Item icon={<Heart size={18} />} label="Мне нравится" route={{ name: "liked" }} count={likes} />
        <Item icon={<ListMusic size={18} />} label="Плейлисты" route={{ name: "playlists" }} count={playlists.length} />
        <Item icon={<History size={18} />} label="История" route={{ name: "history" }} />
        <Item icon={<Download size={18} />} label="Загрузки" route={{ name: "downloads" }} count={downloads} />
      </nav>

      <div className="nav-title row">
        <span className="grow">Плейлисты</span>
        <button className="icon-btn small" title="Новый плейлист" onClick={() => openModal({ type: "createPlaylist" })}>
          <Plus size={15} />
        </button>
      </div>
      <div className="sidebar-playlists">
        {playlists.map((p) => (
          <button
            key={p.id}
            className={`pl-item ${route.name === "playlist" && route.id === p.id ? "active" : ""}`}
            onClick={() => go({ name: "playlist", id: p.id })}
          >
            <Mosaic covers={p.tracks.map((t) => t.cover)} size={34} />
            <div className="grow ellipsis">
              <div className="ellipsis">{p.name}</div>
              <div className="muted small">{p.tracks.length} тр.</div>
            </div>
          </button>
        ))}
        {!playlists.length && <div className="muted small pad">Создайте плейлист или импортируйте из Spotify</div>}
      </div>

      <nav className="nav-group bottom">
        <AccountChip />
        <Item icon={<Settings size={18} />} label="Настройки" route={{ name: "settings" }} />
      </nav>
    </aside>
  );
}

function AccountChip() {
  const session = useAccount((s) => s.session);
  const status = useAccount((s) => s.status);
  const go = useUi((s) => s.go);
  return (
    <button className="nav-item" onClick={() => go({ name: "settings", tab: "accounts" })} title="Аккаунт Nota">
      {session ? <Cloud size={18} className={status === "error" ? "danger-text" : "accent-text"} /> : <CloudOff size={18} />}
      <span className="grow ellipsis">{session ? session.email : "Войти в аккаунт"}</span>
    </button>
  );
}
