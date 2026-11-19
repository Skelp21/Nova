import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight, Minus, Search, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useUi } from "../store/ui";

export function TitleBar() {
  const { route, go, goBack, goForward, back, forward } = useUi();
  const [q, setQ] = useState("");
  const win = getCurrentWindow();

  useEffect(() => {
    if (route.name === "search" && route.query !== undefined) setQ(route.query);
  }, [route]);

  const submit = () => {
    const query = q.trim();
    if (query) go({ name: "search", query });
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="tb-nav">
        <button className="icon-btn" disabled={!back.length} onClick={goBack} title="Назад">
          <ChevronLeft size={18} />
        </button>
        <button className="icon-btn" disabled={!forward.length} onClick={goForward} title="Вперёд">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="tb-search">
        <Search size={16} />
        <input
          id="global-search"
          value={q}
          placeholder="Трек, исполнитель, альбом…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          onFocus={() => route.name !== "search" && go({ name: "search", query: q })}
        />
        {q && (
          <button className="icon-btn small" onClick={() => setQ("")}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="tb-drag" data-tauri-drag-region />
      <div className="tb-window">
        <button onClick={() => win.minimize()} title="Свернуть">
          <Minus size={16} />
        </button>
        <button onClick={() => win.toggleMaximize()} title="Развернуть">
          <Square size={13} />
        </button>
        <button className="close" onClick={() => win.close()} title="Закрыть">
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
