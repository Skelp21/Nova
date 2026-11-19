import {
  Download,
  Gauge,
  Heart,
  ListMusic,
  Loader2,
  MicVocal,
  PictureInPicture2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  ThumbsDown,
  Volume1,
  Volume2,
  VolumeX,
  Waves,
} from "lucide-react";
import { useRef, useState } from "react";
import { api, errText } from "../lib/api";
import { fmtTime } from "../lib/format";
import { useLibrary } from "../store/library";
import { usePlayer } from "../store/player";
import { useSettings } from "../store/settings";
import { toast, useUi } from "../store/ui";
import { Cover } from "./Cover";
import { SourceBadge } from "./TrackList";

export function Seek() {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const buffered = usePlayer((s) => s.buffered);
  const [drag, setDrag] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const ratioAt = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width));
  };
  const onDown = (e: React.PointerEvent) => {
    if (!duration) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag(ratioAt(e.clientX));
  };
  const shown = drag !== null ? drag * duration : position;
  const pct = duration ? (shown / duration) * 100 : 0;
  return (
    <div className="seek">
      <span className="time">{fmtTime(shown)}</span>
      <div
        ref={ref}
        className="slider"
        onPointerDown={onDown}
        onPointerMove={(e) => drag !== null && setDrag(ratioAt(e.clientX))}
        onPointerUp={(e) => {
          if (drag === null) return;
          usePlayer.getState().seek(ratioAt(e.clientX) * duration);
          setDrag(null);
        }}
      >
        <div className="track-bg" />
        <div className="buffered" style={{ width: `${duration ? Math.min(100, (buffered / duration) * 100) : 0}%` }} />
        <div className="fill" style={{ width: `${pct}%` }} />
        <div className="thumb" style={{ left: `${pct}%` }} />
      </div>
      <span className="time">{fmtTime(duration)}</span>
    </div>
  );
}

function Volume() {
  const volume = useSettings((s) => s.volume);
  const muted = useSettings((s) => s.muted);
  const set = useSettings((s) => s.set);
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="volume" onWheel={(e) => set({ volume: Math.min(1, Math.max(0, volume - Math.sign(e.deltaY) * 0.05)) })}>
      <button className="icon-btn" onClick={() => set({ muted: !muted })} title="Звук (M)">
        <Icon size={18} />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(e) => set({ volume: parseFloat(e.target.value), muted: false })}
        style={{ ["--p" as string]: `${(muted ? 0 : volume) * 100}%` }}
      />
    </div>
  );
}

const RATES = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];

export function PlayerBar() {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const wave = usePlayer((s) => s.wave);
  const liked = useLibrary((s) => !!track && s.likes.some((l) => l.id === track.id));
  const downloaded = useLibrary((s) => !!track && !!s.downloads[track.id]);
  const rate = useSettings((s) => s.rate);
  const eqOn = useSettings((s) => s.eq.enabled);
  const { rightPanel, togglePanel, openModal } = useUi();
  const [rateOpen, setRateOpen] = useState(false);
  const p = usePlayer.getState;

  return (
    <footer className="playerbar">
      <div className="pb-left">
        {track ? (
          <>
            <Cover src={track.cover} size={56} radius={8} />
            <div className="pb-text">
              <div className="ellipsis pb-title" title={track.title}>
                {track.title}
              </div>
              <div className="ellipsis muted pb-artist">
                <span className="link" onClick={() => useUi.getState().go({ name: "search", query: track.artist })}>
                  {track.artist}
                </span>
              </div>
              <div className="pb-badges">
                <SourceBadge source={track.source} />
                {wave && (
                  <span className="badge accent">
                    <Waves size={11} /> волна
                  </span>
                )}
              </div>
            </div>
            <button className={`icon-btn like ${liked ? "on" : ""}`} onClick={() => useLibrary.getState().toggleLike(track)} title="Мне нравится (L)">
              <Heart size={18} fill={liked ? "currentColor" : "none"} />
            </button>
            {wave && (
              <button
                className="icon-btn"
                title="Не нравится — пропустить"
                onClick={() => {
                  useLibrary.getState().toggleDislike(track);
                  p().next();
                }}
              >
                <ThumbsDown size={16} />
              </button>
            )}
          </>
        ) : (
          <div className="muted">Ничего не играет — найдите трек или включите «Мою волну»</div>
        )}
      </div>

      <div className="pb-center">
        <div className="pb-controls">
          <button className={`icon-btn ${shuffle ? "on" : ""}`} onClick={() => p().toggleShuffle()} title="Перемешать">
            <Shuffle size={17} />
          </button>
          <button className="icon-btn" onClick={() => p().prev()} title="Назад (Ctrl+←)">
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button className="play-btn" onClick={() => p().toggle()} disabled={!track} title="Пауза/игра (Space)">
            {loading ? <Loader2 size={20} className="spin" /> : playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => p().next()} title="Вперёд (Ctrl+→)">
            <SkipForward size={20} fill="currentColor" />
          </button>
          <button className={`icon-btn ${repeat !== "off" ? "on" : ""}`} onClick={() => p().cycleRepeat()} title="Повтор">
            {repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>
        <Seek />
      </div>

      <div className="pb-right">
        <div className="rate-wrap">
          <button className={`icon-btn ${rate !== 1 ? "on" : ""}`} onClick={() => setRateOpen(!rateOpen)} title="Скорость">
            <Gauge size={17} />
            {rate !== 1 && <span className="rate-label">{rate}×</span>}
          </button>
          {rateOpen && (
            <div className="popover" onMouseLeave={() => setRateOpen(false)}>
              {RATES.map((r) => (
                <button
                  key={r}
                  className={`menu-item ${r === rate ? "on" : ""}`}
                  onClick={() => {
                    useSettings.getState().set({ rate: r });
                    setRateOpen(false);
                  }}
                >
                  {r}×
                </button>
              ))}
            </div>
          )}
        </div>
        <button className={`icon-btn ${eqOn ? "on" : ""}`} onClick={() => openModal({ type: "equalizer" })} title="Эквалайзер">
          <SlidersHorizontal size={17} />
        </button>
        <button
          className={`icon-btn ${downloaded ? "on" : ""}`}
          disabled={!track}
          onClick={() => track && useLibrary.getState().download([track])}
          title={downloaded ? "Скачано" : "Скачать"}
        >
          <Download size={17} />
        </button>
        <button className={`icon-btn ${rightPanel === "lyrics" ? "on" : ""}`} onClick={() => togglePanel("lyrics")} title="Текст песни">
          <MicVocal size={17} />
        </button>
        <button className={`icon-btn ${rightPanel === "queue" ? "on" : ""}`} onClick={() => togglePanel("queue")} title="Очередь">
          <ListMusic size={17} />
        </button>
        <button className="icon-btn" onClick={() => api.openMiniplayer().catch((e) => toast(errText(e), "error"))} title="Мини-плеер">
          <PictureInPicture2 size={17} />
        </button>
        <Volume />
      </div>
    </footer>
  );
}
