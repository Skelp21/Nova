import { Download, Play, Search, Shuffle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { TrackList } from "../components/TrackList";
import { Mosaic } from "../components/Cover";
import { fmtTotal, shuffleArray, tracksWord } from "../lib/format";
import type { Track } from "../lib/types";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";

/** Header + filter + track list, shared by liked/playlist/history/downloads. */
export function Collection({
  kicker,
  title,
  tracks,
  context,
  playlistId,
  cover,
  actions,
  subtitle,
  emptyText,
}: {
  kicker: string;
  title: string;
  tracks: Track[];
  context: string;
  playlistId?: string;
  cover?: ReactNode;
  actions?: ReactNode;
  subtitle?: string;
  emptyText?: string;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return tracks;
    return tracks.filter((t) => `${t.title} ${t.artist} ${t.album ?? ""}`.toLowerCase().includes(f));
  }, [tracks, filter]);
  const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const p = usePlayer.getState;

  return (
    <div className="page">
      <div className="collection-head">
        {cover ?? <Mosaic covers={tracks.map((t) => t.cover)} size={180} />}
        <div className="ch-text">
          <div className="kicker">{kicker}</div>
          <h1>{title}</h1>
          <div className="muted">
            {subtitle ? `${subtitle} · ` : ""}
            {tracksWord(tracks.length)}
            {total > 0 ? ` · ${fmtTotal(total)}` : ""}
          </div>
          <div className="ch-actions">
            <button className="btn primary round" disabled={!tracks.length} onClick={() => p().playList(tracks, 0, title)}>
              <Play size={18} fill="currentColor" /> Слушать
            </button>
            <button className="btn ghost round" disabled={!tracks.length} onClick={() => p().playList(shuffleArray(tracks), 0, title)}>
              <Shuffle size={16} /> Перемешать
            </button>
            <button
              className="icon-btn"
              title="Скачать всё"
              disabled={!tracks.length}
              onClick={() => useLibrary.getState().download(tracks.filter((t) => !t.unavailable))}
            >
              <Download size={18} />
            </button>
            {actions}
          </div>
        </div>
      </div>
      {tracks.length > 8 && (
        <div className="filter">
          <Search size={15} />
          <input placeholder="Фильтр" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}
      <TrackList tracks={shown} context={context} playlistId={filter ? undefined : playlistId} emptyText={emptyText} />
    </div>
  );
}
