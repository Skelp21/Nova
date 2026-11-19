import {
  ChevronDown,
  ChevronLeft,
  Download,
  Heart,
  Home,
  Library,
  ListMusic,
  Loader2,
  MicVocal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useUi, type Route } from "../store/ui";
import { Cover } from "./Cover";
import { Seek } from "./PlayerBar";
import { LyricsView, Queue } from "./RightPanel";
import { SourceBadge } from "./TrackList";

const ROOTS: Route["name"][] = ["home", "search", "library", "settings"];

/** Top bar: back button on inner pages, search field on the search tab. */
export function MobileHeader() {
  const route = useUi((s) => s.route);
  const { go, goBack, back } = useUi.getState();
  const [q, setQ] = useState(route.name === "search" ? route.query ?? "" : "");
  useEffect(() => {
    if (route.name === "search") setQ(route.query ?? "");
  }, [route]);

  if (route.name === "search")
    return (
      <header className="m-header">
        <div className="tb-search m-search">
          <Search size={16} />
          <input
            id="global-search"
            value={q}
            placeholder="Трек, исполнитель…"
            enterKeyHint="search"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q.trim()) {
                go({ name: "search", query: q.trim() });
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {q && (
            <button className="icon-btn small" onClick={() => setQ("")}>
              <X size={14} />
            </button>
          )}
        </div>
      </header>
    );

  const inner = !ROOTS.includes(route.name) && back.length > 0;
  return (
    <header className="m-header">
      {inner ? (
        <button className="icon-btn" onClick={goBack}>
          <ChevronLeft size={22} />
        </button>
      ) : (
        <div className="brand m-brand">
          <img src="/logo.svg" width={24} height={24} />
          <span>Yarvi</span>
        </div>
      )}
    </header>
  );
}

export function MobileNav() {
  const route = useUi((s) => s.route);
  const go = useUi((s) => s.go);
  const wave = usePlayer((s) => s.wave);
  const libraryRoutes = ["library", "liked", "playlists", "playlist", "history", "downloads"];
  const tab = (name: Route["name"], label: string, icon: ReactNode, active: boolean, onClick?: () => void) => (
    <button className={`m-tab ${active ? "on" : ""}`} onClick={onClick ?? (() => go({ name } as Route))}>
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="m-nav">
      {tab("home", "Главная", <Home size={22} />, route.name === "home")}
      {tab("search", "Поиск", <Search size={22} />, route.name === "search")}
      {tab("home", "Волна", <Waves size={22} />, wave, () => usePlayer.getState().startWave())}
      {tab("library", "Медиатека", <Library size={22} />, libraryRoutes.includes(route.name))}
      {tab("settings", "Настройки", <Settings size={22} />, route.name === "settings")}
    </nav>
  );
}

/** Compact player above the tab bar; tap opens the full player. */
export function MiniBar() {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const open = useUi((s) => s.setNowPlaying);
  if (!track) return null;
  const pct = duration ? (position / duration) * 100 : 0;
  return (
    <div className="m-mini" onClick={() => open(true)}>
      <div className="m-mini-progress" style={{ width: `${pct}%` }} />
      <Cover src={track.cover} size={42} radius={8} />
      <div className="grow ellipsis">
        <div className="ellipsis strong">{track.title}</div>
        <div className="ellipsis muted small">{track.artist}</div>
      </div>
      <button
        className="icon-btn"
        onClick={(e) => {
          e.stopPropagation();
          usePlayer.getState().toggle();
        }}
      >
        {loading ? <Loader2 size={22} className="spin" /> : playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
      </button>
      <button
        className="icon-btn"
        onClick={(e) => {
          e.stopPropagation();
          usePlayer.getState().next();
        }}
      >
        <SkipForward size={22} fill="currentColor" />
      </button>
    </div>
  );
}

/** Full-screen player sheet. */
export function NowPlaying() {
  const open = useUi((s) => s.nowPlaying);
  const close = () => useUi.getState().setNowPlaying(false);
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const liked = useLibrary((s) => !!track && s.likes.some((l) => l.id === track.id));
  const downloaded = useLibrary((s) => !!track && !!s.downloads[track.id]);
  const [view, setView] = useState<"cover" | "lyrics" | "queue">("cover");
  const p = usePlayer.getState;

  // Swipe down to close.
  const [startY, setStartY] = useState<number | null>(null);

  if (!open || !track) return null;
  return (
    <div
      className="m-sheet"
      onTouchStart={(e) => setStartY(e.touches[0].clientY)}
      onTouchEnd={(e) => {
        if (startY !== null && view === "cover" && e.changedTouches[0].clientY - startY > 120) close();
        setStartY(null);
      }}
    >
      {track.cover && <div className="m-sheet-bg" style={{ backgroundImage: `url("${track.cover}")` }} />}
      <div className="m-sheet-top">
        <button className="icon-btn" onClick={close}>
          <ChevronDown size={26} />
        </button>
        <div className="tabs">
          <button className={view === "cover" ? "on" : ""} onClick={() => setView("cover")}>
            Обложка
          </button>
          <button className={view === "lyrics" ? "on" : ""} onClick={() => setView("lyrics")}>
            Текст
          </button>
          <button className={view === "queue" ? "on" : ""} onClick={() => setView("queue")}>
            Очередь
          </button>
        </div>
        <div style={{ width: 34 }} />
      </div>

      <div className="m-sheet-main">
        {view === "cover" && (
          <div className="m-big-cover">
            <Cover src={track.cover} size={Math.min(window.innerWidth - 56, 380)} radius={16} />
          </div>
        )}
        {view === "lyrics" && <LyricsView />}
        {view === "queue" && <Queue />}
      </div>

      <div className="m-sheet-info">
        <div className="grow ellipsis">
          <div className="m-title ellipsis">{track.title}</div>
          <div
            className="muted ellipsis link"
            onClick={() => useUi.getState().go({ name: "search", query: track.artist })}
          >
            {track.artist}
          </div>
        </div>
        <SourceBadge source={track.source} />
        <button className={`icon-btn like ${liked ? "on" : ""}`} onClick={() => useLibrary.getState().toggleLike(track)}>
          <Heart size={24} fill={liked ? "currentColor" : "none"} />
        </button>
      </div>

      <Seek />

      <div className="m-controls">
        <button className={`icon-btn ${shuffle ? "on" : ""}`} onClick={() => p().toggleShuffle()}>
          <Shuffle size={22} />
        </button>
        <button className="icon-btn" onClick={() => p().prev()}>
          <SkipBack size={30} fill="currentColor" />
        </button>
        <button className="play-btn big" onClick={() => p().toggle()}>
          {loading ? <Loader2 size={30} className="spin" /> : playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
        </button>
        <button className="icon-btn" onClick={() => p().next()}>
          <SkipForward size={30} fill="currentColor" />
        </button>
        <button className={`icon-btn ${repeat !== "off" ? "on" : ""}`} onClick={() => p().cycleRepeat()}>
          {repeat === "one" ? <Repeat1 size={22} /> : <Repeat size={22} />}
        </button>
      </div>

      <div className="m-actions">
        <button className={`icon-btn ${downloaded ? "on" : ""}`} onClick={() => useLibrary.getState().download([track])}>
          <Download size={20} />
        </button>
        <button className={`icon-btn ${view === "lyrics" ? "on" : ""}`} onClick={() => setView(view === "lyrics" ? "cover" : "lyrics")}>
          <MicVocal size={20} />
        </button>
        <button className="icon-btn" onClick={() => useUi.getState().openModal({ type: "addToPlaylist", tracks: [track] })}>
          <ListMusic size={20} />
        </button>
        <button className="icon-btn" onClick={() => useUi.getState().openModal({ type: "equalizer" })}>
          <SlidersHorizontal size={20} />
        </button>
        <button className="icon-btn" onClick={() => p().startWave(track)}>
          <Waves size={20} />
        </button>
      </div>
    </div>
  );
}
