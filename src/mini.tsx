import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Heart, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Cover } from "./components/Cover";
import { fmtTime } from "./lib/format";
import type { MiniCmd, MiniState } from "./lib/integrations";
import "./styles/app.css";

// Same colours as the main window.
try {
  const v = JSON.parse(localStorage.getItem("nota-theme-vars") || "null");
  if (v) for (const k of ["bg", "card", "fg", "accent"]) document.documentElement.style.setProperty(`--${k}`, v[k]);
} catch {
  /* defaults from CSS */
}

const cmd = (c: MiniCmd) => emit("mini:cmd", c);

function Mini() {
  const [s, setS] = useState<MiniState | null>(null);
  useEffect(() => {
    const un = listen<MiniState>("mini:state", (e) => setS(e.payload));
    emit("mini:ready");
    return () => {
      un.then((f) => f());
    };
  }, []);
  const t = s?.track;
  const pct = s && s.duration ? (s.position / s.duration) * 100 : 0;
  return (
    <div className="mini-card" data-tauri-drag-region>
      <Cover src={t?.cover} size={84} radius={10} />
      <div className="mini-body" data-tauri-drag-region>
        <div className="mini-top" data-tauri-drag-region>
          <div className="grow ellipsis" data-tauri-drag-region>
            <div className="ellipsis strong">{t?.title ?? "Ничего не играет"}</div>
            <div className="ellipsis muted small">{t?.artist ?? ""}</div>
          </div>
          <button className="icon-btn small" onClick={() => getCurrentWindow().close()}>
            <X size={14} />
          </button>
        </div>
        <div className="mini-controls">
          <button className={`icon-btn small like ${s?.liked ? "on" : ""}`} onClick={() => cmd("like")}>
            <Heart size={15} fill={s?.liked ? "currentColor" : "none"} />
          </button>
          <button className="icon-btn" onClick={() => cmd("prev")}>
            <SkipBack size={17} fill="currentColor" />
          </button>
          <button className="play-btn small" onClick={() => cmd("toggle")}>
            {s?.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => cmd("next")}>
            <SkipForward size={17} fill="currentColor" />
          </button>
          <span className="muted small mini-time">
            {fmtTime(s?.position ?? 0)} / {fmtTime(s?.duration ?? 0)}
          </span>
        </div>
        <div
          className="mini-progress"
          onClick={(e) => {
            if (!s?.duration) return;
            const r = e.currentTarget.getBoundingClientRect();
            cmd({ seek: ((e.clientX - r.left) / r.width) * s.duration });
          }}
        >
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Mini />
  </StrictMode>,
);
