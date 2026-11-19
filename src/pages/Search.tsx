import { Loader2, LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { TrackList } from "../components/TrackList";
import { api, errText } from "../lib/api";
import { SOURCES, sourceName, type Source, type Track } from "../lib/types";
import { useSettings } from "../store/settings";
import { useUi } from "../store/ui";

type Tab = "all" | Source;
type Result = { tracks: Track[]; error?: string; loading: boolean };

const cache = new Map<string, Track[]>();

function useSearch(source: Source, query: string, limit: number, enabled: boolean): Result {
  const key = `${source}|${limit}|${query}`;
  const [res, setRes] = useState<Result>({ tracks: cache.get(key) ?? [], loading: false });
  useEffect(() => {
    if (!enabled || !query) return setRes({ tracks: [], loading: false });
    const hit = cache.get(key);
    if (hit) return setRes({ tracks: hit, loading: false });
    let alive = true;
    setRes({ tracks: [], loading: true });
    api
      .search(source, query, limit)
      .then((tracks) => {
        cache.set(key, tracks);
        if (alive) setRes({ tracks, loading: false });
      })
      .catch((e) => alive && setRes({ tracks: [], loading: false, error: errText(e) }));
    return () => {
      alive = false;
    };
  }, [key, enabled]);
  return res;
}

function SourceBlock({ source, query, limit, title }: { source: Source; query: string; limit: number; title?: boolean }) {
  const res = useSearch(source, query, limit, true);
  const go = useUi((s) => s.go);
  const needsLogin = res.error && /войдите/i.test(res.error);
  return (
    <section className="search-block">
      {title && <h2 className={`src-title src-${source}`}>{sourceName(source)}</h2>}
      {res.loading && (
        <div className="empty small">
          <Loader2 className="spin" size={18} /> Ищу…
        </div>
      )}
      {res.error &&
        (needsLogin ? (
          <div className="hint">
            <span>{res.error}</span>
            <button className="btn ghost small" onClick={() => go({ name: "settings", tab: "accounts" })}>
              <LogIn size={14} /> Войти
            </button>
          </div>
        ) : (
          <div className="hint error">{res.error}</div>
        ))}
      {!res.loading && !res.error && <TrackList tracks={res.tracks} context={`Поиск: ${query}`} emptyText="Ничего не найдено" />}
    </section>
  );
}

export function SearchPage({ query }: { query?: string }) {
  const enabled = useSettings((s) => s.enabledSources);
  const [tab, setTab] = useState<Tab>("all");
  const q = (query ?? "").trim();
  const sources = SOURCES.filter((s) => enabled[s.id]).map((s) => s.id);

  if (!q)
    return (
      <div className="page">
        <h1>Поиск</h1>
        <p className="muted">
          Ищите сразу во всех подключённых сервисах: {sources.map(sourceName).join(", ")}. Подсказка: Ctrl+F — быстрый переход к поиску.
        </p>
        <div className="genre-grid">
          {["Русский рэп", "Lo-fi", "Phonk", "Рок 2000-х", "Синтвейв", "Джаз", "Хиты 2026", "Инди", "Для тренировки", "Для сна"].map((g, i) => (
            <button key={g} className={`genre g${i % 6}`} onClick={() => useUi.getState().go({ name: "search", query: g })}>
              {g}
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="ellipsis">«{q}»</h1>
      </div>
      <div className="tabs big">
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
          Все
        </button>
        {sources.map((s) => (
          <button key={s} className={tab === s ? "on" : ""} onClick={() => setTab(s)}>
            {sourceName(s)}
          </button>
        ))}
      </div>
      {tab === "all" ? (
        sources.map((s) => <SourceBlock key={s} source={s} query={q} limit={8} title />)
      ) : (
        <SourceBlock key={tab} source={tab} query={q} limit={50} />
      )}
    </div>
  );
}
