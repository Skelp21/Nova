import { Download, Heart, MoreHorizontal, Pause, Play } from "lucide-react";
import { memo, useMemo } from "react";
import { fmtTime } from "../lib/format";
import { sourceName, type Track } from "../lib/types";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useUi } from "../store/ui";
import { useSettings } from "../store/settings";
import { Cover } from "./Cover";
import { isMobile } from "../lib/platform";

export function SourceBadge({ source }: { source: Track["source"] }) {
  return (
    <span className={`badge src-${source}`} title={sourceName(source)}>
      {{ youtube: "YT", soundcloud: "SC", vk: "VK", yandex: "ЯМ" }[source]}
    </span>
  );
}

interface RowProps {
  track: Track;
  index: number;
  active: boolean;
  playing: boolean;
  liked: boolean;
  downloaded: boolean;
  progress?: number;
  showAlbum: boolean;
  onPlay: (i: number) => void;
  onMenu: (e: React.MouseEvent, i: number) => void;
}

const Row = memo(function Row(p: RowProps) {
  const t = p.track;
  return (
    <div
      className={`track-row ${p.active ? "active" : ""} ${t.unavailable ? "unavailable" : ""}`}
      onDoubleClick={() => p.onPlay(p.index)}
      onClick={isMobile ? () => p.onPlay(p.index) : undefined}
      onContextMenu={(e) => p.onMenu(e, p.index)}
    >
      <div className="tr-index">
        <span className="num">{p.active && p.playing ? <span className="eq-bars"><i /><i /><i /></span> : p.index + 1}</span>
        <button className="play" onClick={(e) => {
            e.stopPropagation();
            if (p.active) usePlayer.getState().toggle();
            else p.onPlay(p.index);
          }}>
          {p.active && p.playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
      </div>
      <div className="tr-main">
        <Cover src={t.cover} size={40} />
        <div className="tr-text">
          <div className="tr-title ellipsis">{t.title}</div>
          <div className="tr-artist ellipsis">
            {t.unavailable && <span className="badge warn">недоступен</span>}
            <span
              className="link"
              onClick={(e) => {
                e.stopPropagation();
                useUi.getState().go({ name: "search", query: t.artist });
              }}
            >
              {t.artist || "Неизвестный исполнитель"}
            </span>
          </div>
        </div>
      </div>
      {p.showAlbum && <div className="tr-album ellipsis muted">{t.album ?? ""}</div>}
      <div className="tr-meta">
        {p.progress !== undefined ? (
          <span className="dl-progress" title="Скачивается">{Math.round(p.progress * 100)}%</span>
        ) : (
          p.downloaded && <Download size={14} className="accent-text" />
        )}
        <SourceBadge source={t.source} />
        <button
          className={`icon-btn small like ${p.liked ? "on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            useLibrary.getState().toggleLike(t);
          }}
          title={p.liked ? "Убрать из «Мне нравится»" : "Мне нравится"}
        >
          <Heart size={15} fill={p.liked ? "currentColor" : "none"} />
        </button>
        <span className="tr-dur muted">{t.duration ? fmtTime(t.duration) : ""}</span>
        <button className="icon-btn small more" onClick={(e) => p.onMenu(e, p.index)}>
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  );
});

export function TrackList({
  tracks,
  context,
  playlistId,
  showAlbum = true,
  emptyText = "Здесь пока пусто",
}: {
  tracks: Track[];
  context: string;
  playlistId?: string;
  showAlbum?: boolean;
  emptyText?: string;
}) {
  const current = usePlayer((s) => s.queue[s.index]?.id);
  const playing = usePlayer((s) => s.playing);
  const likes = useLibrary((s) => s.likes);
  const downloads = useLibrary((s) => s.downloads);
  const downloading = useUi((s) => s.downloading);
  const compact = useSettings((s) => s.compactRows);
  const likedSet = useMemo(() => new Set(likes.map((l) => l.id)), [likes]);

  const onPlay = (i: number) => usePlayer.getState().playList(tracks, i, context);
  const onMenu = (e: React.MouseEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    useUi.getState().openMenu({ x: e.clientX, y: e.clientY, track: tracks[i], playlistId, index: i });
  };

  if (!tracks.length) return <div className="empty">{emptyText}</div>;
  return (
    <div className={`track-list ${compact ? "compact" : ""} ${showAlbum ? "" : "no-album"}`}>
      {tracks.map((t, i) => (
        <Row
          key={`${t.id}-${i}`}
          track={t}
          index={i}
          active={t.id === current}
          playing={playing}
          liked={likedSet.has(t.id)}
          downloaded={!!downloads[t.id]}
          progress={downloading[t.id]}
          showAlbum={showAlbum}
          onPlay={onPlay}
          onMenu={onMenu}
        />
      ))}
    </div>
  );
}
