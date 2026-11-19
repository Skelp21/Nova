import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  ExternalLink,
  Heart,
  Info,
  ListEnd,
  ListPlus,
  ListStart,
  Play,
  Search,
  ThumbsDown,
  Trash2,
  Waves,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { toast, useUi } from "../store/ui";

function MI({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className={`menu-item ${danger ? "danger" : ""}`}
      onClick={() => {
        onClick();
        useUi.getState().closeMenu();
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const likes = useLibrary((s) => s.likes);
  const downloads = useLibrary((s) => s.downloads);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu]);

  if (!menu) return null;
  const t = menu.track;
  const liked = likes.some((l) => l.id === t.id);
  const lib = useLibrary.getState();
  const player = usePlayer.getState();
  const ui = useUi.getState();

  return (
    <div className="menu-backdrop" onMouseDown={() => ui.closeMenu()} onContextMenu={(e) => { e.preventDefault(); ui.closeMenu(); }}>
      <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="menu-head ellipsis">
          {t.artist} — {t.title}
        </div>
        <MI icon={<Play size={15} />} label="Играть" onClick={() => player.playList([t], 0)} />
        <MI icon={<ListStart size={15} />} label="Играть следующим" onClick={() => player.playNext([t])} />
        <MI icon={<ListEnd size={15} />} label="Добавить в очередь" onClick={() => player.addToQueue([t])} />
        <MI icon={<Waves size={15} />} label="Волна по треку" onClick={() => player.startWave(t)} />
        <div className="menu-sep" />
        <MI
          icon={<Heart size={15} fill={liked ? "currentColor" : "none"} />}
          label={liked ? "Убрать из «Мне нравится»" : "Мне нравится"}
          onClick={() => lib.toggleLike(t)}
        />
        <MI icon={<ThumbsDown size={15} />} label="Не нравится" onClick={() => lib.toggleDislike(t)} />
        <MI icon={<ListPlus size={15} />} label="Добавить в плейлист…" onClick={() => ui.openModal({ type: "addToPlaylist", tracks: [t] })} />
        {!downloads[t.id] ? (
          <MI icon={<Download size={15} />} label="Скачать" onClick={() => lib.download([t])} />
        ) : (
          <MI icon={<Trash2 size={15} />} label="Удалить загрузку" onClick={() => lib.removeDownload(t.id, true)} />
        )}
        <div className="menu-sep" />
        <MI icon={<Search size={15} />} label="Найти исполнителя" onClick={() => ui.go({ name: "search", query: t.artist })} />
        {t.link && <MI icon={<ExternalLink size={15} />} label="Открыть в браузере" onClick={() => openUrl(t.link!)} />}
        {t.link && (
          <MI
            icon={<Copy size={15} />}
            label="Копировать ссылку"
            onClick={() => navigator.clipboard.writeText(t.link!).then(() => toast("Ссылка скопирована"))}
          />
        )}
        <MI icon={<Info size={15} />} label="О треке" onClick={() => ui.openModal({ type: "trackInfo", track: t })} />
        {menu.playlistId !== undefined && menu.index !== undefined && (
          <>
            <div className="menu-sep" />
            <MI icon={<ArrowUp size={15} />} label="Выше" onClick={() => lib.moveInPlaylist(menu.playlistId!, menu.index!, menu.index! - 1)} />
            <MI icon={<ArrowDown size={15} />} label="Ниже" onClick={() => lib.moveInPlaylist(menu.playlistId!, menu.index!, menu.index! + 1)} />
            <MI icon={<Trash2 size={15} />} label="Убрать из плейлиста" danger onClick={() => lib.removeFromPlaylist(menu.playlistId!, menu.index!)} />
          </>
        )}
      </div>
    </div>
  );
}
