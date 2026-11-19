import { ArrowDown, ArrowUp, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { fmtTime } from "../lib/format";
import { activeIndex, parseLrc } from "../lib/lrc";
import type { Lyrics } from "../lib/types";
import { usePlayer } from "../store/player";
import { useUi } from "../store/ui";
import { Cover } from "./Cover";

export function Queue() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const context = usePlayer((s) => s.context);
  const p = usePlayer.getState;
  const upcoming = queue.slice(index + 1);
  const cur = queue[index];
  return (
    <div className="panel-body">
      {cur && (
        <>
          <div className="panel-sub">Сейчас играет{context ? ` · ${context}` : ""}</div>
          <div className="q-item active">
            <Cover src={cur.cover} size={40} />
            <div className="grow ellipsis">
              <div className="ellipsis">{cur.title}</div>
              <div className="muted small ellipsis">{cur.artist}</div>
            </div>
          </div>
        </>
      )}
      <div className="panel-sub row">
        <span className="grow">Далее · {upcoming.length}</span>
        {upcoming.length > 0 && (
          <button className="text-btn" onClick={() => p().clearQueue()}>
            Очистить
          </button>
        )}
      </div>
      {upcoming.map((t, k) => {
        const i = index + 1 + k;
        return (
          <div key={`${t.id}-${i}`} className="q-item" onDoubleClick={() => p().jumpTo(i)}>
            <Cover src={t.cover} size={40} />
            <div className="grow ellipsis" onClick={() => p().jumpTo(i)}>
              <div className="ellipsis">{t.title}</div>
              <div className="muted small ellipsis">
                {t.artist} · {fmtTime(t.duration)}
              </div>
            </div>
            <div className="q-actions">
              <button className="icon-btn small" onClick={() => p().moveInQueue(i, i - 1)} disabled={k === 0}>
                <ArrowUp size={14} />
              </button>
              <button className="icon-btn small" onClick={() => p().moveInQueue(i, i + 1)} disabled={i === queue.length - 1}>
                <ArrowDown size={14} />
              </button>
              <button className="icon-btn small" onClick={() => p().removeAt(i)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}
      {!queue.length && <div className="empty">Очередь пуста</div>}
    </div>
  );
}

const lyricsCache = new Map<string, Lyrics>();

export function LyricsView() {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const position = usePlayer((s) => s.position);
  const [data, setData] = useState<Lyrics | null>(null);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!track) return setData(null);
    const cached = lyricsCache.get(track.id);
    if (cached) return setData(cached);
    let alive = true;
    setLoading(true);
    setData(null);
    api
      .lyrics(track.title, track.artist, track.duration)
      .then((l) => {
        lyricsCache.set(track.id, l);
        if (alive) setData(l);
      })
      .catch(() => alive && setData({}))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [track?.id]);

  const lines = useMemo(() => (data?.synced ? parseLrc(data.synced) : []), [data]);
  const active = lines.length ? activeIndex(lines, position) : -1;

  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  if (!track) return <div className="empty">Включите трек</div>;
  if (loading)
    return (
      <div className="empty">
        <Loader2 className="spin" /> Ищу текст…
      </div>
    );
  if (lines.length)
    return (
      <div className="panel-body lyrics" ref={box}>
        {lines.map((l, i) => (
          <p
            key={i}
            data-i={i}
            className={i === active ? "on" : i < active ? "past" : ""}
            onClick={() => usePlayer.getState().seek(l.time)}
          >
            {l.text || "♪"}
          </p>
        ))}
      </div>
    );
  if (data?.plain)
    return (
      <div className="panel-body lyrics plain">
        {data.plain.split("\n").map((l, i) => (
          <p key={i}>{l || " "}</p>
        ))}
      </div>
    );
  return <div className="empty">Текст не найден</div>;
}

export function RightPanel() {
  const panel = useUi((s) => s.rightPanel);
  const setPanel = useUi((s) => s.setPanel);
  if (!panel) return null;
  return (
    <aside className="right-panel">
      <div className="panel-head">
        <div className="tabs">
          <button className={panel === "queue" ? "on" : ""} onClick={() => setPanel("queue")}>
            Очередь
          </button>
          <button className={panel === "lyrics" ? "on" : ""} onClick={() => setPanel("lyrics")}>
            Текст
          </button>
        </div>
        <button className="icon-btn small" onClick={() => setPanel(null)}>
          <X size={16} />
        </button>
      </div>
      {panel === "queue" ? <Queue /> : <LyricsView />}
    </aside>
  );
}
