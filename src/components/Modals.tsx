import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2, Plus, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { api, errText } from "../lib/api";
import { EQ_FREQS, EQ_PRESETS } from "../lib/audio";
import { fmtTime } from "../lib/format";
import { matchAll } from "../lib/importer";
import { SOURCES, sourceName, type Source } from "../lib/types";
import { useLibrary } from "../store/library";
import { useSettings } from "../store/settings";
import { toast, useUi } from "../store/ui";
import { Cover, Mosaic } from "./Cover";

function Shell({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  const close = useUi((s) => s.closeModal);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className={`modal ${wide ? "wide" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn small" onClick={close}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NameModal({ title, initial, onSubmit }: { title: string; initial: string; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const close = useUi((s) => s.closeModal);
  const submit = () => {
    onSubmit(name);
    close();
  };
  return (
    <Shell title={title}>
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Название" />
      <div className="modal-actions">
        <button className="btn ghost" onClick={close}>
          Отмена
        </button>
        <button className="btn primary" onClick={submit}>
          Сохранить
        </button>
      </div>
    </Shell>
  );
}

function AddToPlaylist({ tracks }: { tracks: import("../lib/types").Track[] }) {
  const playlists = useLibrary((s) => s.playlists);
  const close = useUi((s) => s.closeModal);
  const openModal = useUi((s) => s.openModal);
  return (
    <Shell title={tracks.length > 1 ? `Добавить ${tracks.length} треков` : "Добавить в плейлист"}>
      <div className="pick-list">
        <button className="pick-item" onClick={() => openModal({ type: "createPlaylist", tracks })}>
          <div className="cover cover-empty" style={{ width: 40, height: 40, borderRadius: 8 }}>
            <Plus size={18} />
          </div>
          <span>Новый плейлист</span>
        </button>
        {playlists.map((p) => (
          <button
            key={p.id}
            className="pick-item"
            onClick={() => {
              const n = useLibrary.getState().addToPlaylist(p.id, tracks);
              toast(n ? `Добавлено в «${p.name}»` : "Уже есть в плейлисте", n ? "success" : "info");
              close();
            }}
          >
            <Mosaic covers={p.tracks.map((t) => t.cover)} size={40} />
            <div className="grow ellipsis">
              <div>{p.name}</div>
              <div className="muted small">{p.tracks.length} тр.</div>
            </div>
          </button>
        ))}
      </div>
    </Shell>
  );
}

function Equalizer() {
  const eq = useSettings((s) => s.eq);
  const preset = useSettings((s) => s.eqPreset);
  const custom = useSettings((s) => s.customPresets);
  const { setEq, set } = useSettings.getState();
  const [newName, setNewName] = useState("");
  const all = { ...EQ_PRESETS, ...custom };
  const fmtHz = (f: number) => (f >= 1000 ? `${f / 1000}к` : `${f}`);
  return (
    <Shell title="Эквалайзер" wide>
      <div className="row gap">
        <label className="switch">
          <input type="checkbox" checked={eq.enabled} onChange={(e) => setEq({ enabled: e.target.checked })} />
          <span />
        </label>
        <span>{eq.enabled ? "Включён" : "Выключен"}</span>
        <div className="grow" />
        <select
          className="select"
          value={all[preset] ? preset : ""}
          onChange={(e) => {
            set({ eqPreset: e.target.value });
            setEq({ bands: all[e.target.value].slice(), enabled: true });
          }}
        >
          <option value="" disabled>
            Свой
          </option>
          {Object.keys(all).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <input className="input small" style={{ width: 130 }} placeholder="Имя пресета" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button
          className="btn ghost small"
          disabled={!newName.trim()}
          onClick={() => {
            const name = newName.trim();
            set({ customPresets: { ...custom, [name]: eq.bands.slice() }, eqPreset: name });
            setNewName("");
          }}
        >
          Сохранить
        </button>
        {custom[preset] && (
          <button
            className="btn ghost small"
            onClick={() => {
              const next = { ...custom };
              delete next[preset];
              set({ customPresets: next, eqPreset: "Ровно" });
            }}
          >
            Удалить
          </button>
        )}
      </div>
      <div className={`eq ${eq.enabled ? "" : "disabled"}`}>
        <div className="eq-band preamp">
          <span className="eq-val">{eq.preamp > 0 ? "+" : ""}{eq.preamp.toFixed(0)}</span>
          <input type="range" min={-12} max={12} step={0.5} value={eq.preamp} onChange={(e) => setEq({ preamp: parseFloat(e.target.value) })} />
          <span className="eq-hz">Пред.</span>
        </div>
        {EQ_FREQS.map((f, i) => (
          <div className="eq-band" key={f}>
            <span className="eq-val">{eq.bands[i] > 0 ? "+" : ""}{eq.bands[i].toFixed(0)}</span>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={eq.bands[i]}
              onChange={(e) => {
                const bands = eq.bands.slice();
                bands[i] = parseFloat(e.target.value);
                setEq({ bands });
                set({ eqPreset: "" });
              }}
              onDoubleClick={() => {
                const bands = eq.bands.slice();
                bands[i] = 0;
                setEq({ bands });
              }}
            />
            <span className="eq-hz">{fmtHz(f)}</span>
          </div>
        ))}
      </div>
      <div className="muted small">Двойной клик по ползунку — сброс полосы в 0 дБ.</div>
    </Shell>
  );
}

function ImportModal() {
  const [tab, setTab] = useState<"spotify" | "apple" | "soundcloud" | "vk" | "yandex">("spotify");
  const [link, setLink] = useState("");
  const source = useSettings((s) => s.importSource);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [missed, setMissed] = useState<string[]>([]);
  const stop = useRef(false);
  const close = useUi((s) => s.closeModal);
  const go = useUi((s) => s.go);

  /** Spotify / Apple Music: read the list, then find each track in the chosen service. */
  const runMatched = async (kind: "spotify" | "apple") => {
    setBusy(true);
    setMissed([]);
    stop.current = false;
    try {
      const pl = kind === "spotify" ? await api.spotifyImport(link.trim()) : await api.appleImport(link.trim());
      if (!pl.items.length) throw new Error("плейлист пустой");
      setProgress({ done: 0, total: pl.items.length });
      const res = await matchAll(pl, source, (done, total) => setProgress({ done, total }), () => stop.current);
      const id = useLibrary.getState().createPlaylist(pl.name, res.tracks, kind === "spotify" ? "Spotify" : "Apple Music");
      setMissed(res.missed);
      toast(`Импортировано ${res.tracks.length} из ${pl.items.length}`, "success");
      go({ name: "playlist", id });
      if (!res.missed.length) close();
    } catch (e) {
      toast(`Импорт: ${errText(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  /** SoundCloud tracks are playable as-is: no matching needed. */
  const runSoundcloud = async () => {
    setBusy(true);
    try {
      const { name, tracks } = await api.soundcloudImport(link.trim());
      if (!tracks.length) throw new Error("треков не найдено");
      const id = useLibrary.getState().createPlaylist(name, tracks, "SoundCloud");
      toast(`Импортировано ${tracks.length} треков`, "success");
      go({ name: "playlist", id });
      close();
    } catch (e) {
      toast(`Импорт: ${errText(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const runService = async (kind: "vk" | "yandex") => {
    setBusy(true);
    try {
      const tracks = kind === "vk" ? await api.vkMyAudio() : await api.yandexLikes();
      const id = useLibrary.getState().createPlaylist(kind === "vk" ? "Моя музыка ВК" : "Мне нравится (Яндекс)", tracks, sourceName(kind));
      toast(`Импортировано ${tracks.length} треков`, "success");
      go({ name: "playlist", id });
      close();
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Импорт музыки" wide>
      <div className="tabs big">
        <button className={tab === "spotify" ? "on" : ""} onClick={() => setTab("spotify")}>
          Spotify
        </button>
        <button className={tab === "apple" ? "on" : ""} onClick={() => setTab("apple")}>
          Apple Music
        </button>
        <button className={tab === "soundcloud" ? "on" : ""} onClick={() => setTab("soundcloud")}>
          SoundCloud
        </button>
        <button className={tab === "vk" ? "on" : ""} onClick={() => setTab("vk")}>
          ВКонтакте
        </button>
        <button className={tab === "yandex" ? "on" : ""} onClick={() => setTab("yandex")}>
          Яндекс Музыка
        </button>
      </div>
      {(tab === "spotify" || tab === "apple") && (
        <>
          <p className="muted">
            {tab === "spotify"
              ? "Вставьте ссылку на публичный плейлист или альбом Spotify."
              : "Вставьте ссылку на плейлист или альбом Apple Music (Поделиться → Скопировать ссылку). Плейлист должен быть публичным."}{" "}
            Каждый трек будет найден в выбранном сервисе и сохранён как плейлист.
          </p>
          <input
            className="input"
            placeholder={tab === "spotify" ? "https://open.spotify.com/playlist/…" : "https://music.apple.com/…/playlist/…"}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={busy}
          />
          <div className="row gap">
            <span>Искать в:</span>
            {SOURCES.map((s) => (
              <button key={s.id} className={`chip ${source === s.id ? "on" : ""}`} onClick={() => useSettings.getState().set({ importSource: s.id as Source })} disabled={busy}>
                {s.name}
              </button>
            ))}
          </div>
          {progress && (
            <div className="progress-line">
              <div style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              <span>
                {progress.done} / {progress.total}
              </span>
            </div>
          )}
          {missed.length > 0 && (
            <details className="missed">
              <summary>Не нашлось: {missed.length}</summary>
              {missed.map((m) => (
                <div key={m} className="small muted">
                  {m}
                </div>
              ))}
            </details>
          )}
          <div className="modal-actions">
            {busy && (
              <button className="btn ghost" onClick={() => (stop.current = true)}>
                Остановить
              </button>
            )}
            <button className="btn primary" disabled={busy || !link.trim()} onClick={() => runMatched(tab as "spotify" | "apple")}>
              {busy ? <Loader2 size={16} className="spin" /> : null} Импортировать
            </button>
          </div>
        </>
      )}
      {tab === "soundcloud" && (
        <>
          <p className="muted">
            Вставьте ссылку на плейлист или альбом SoundCloud, на профиль (перенесутся его лайки) или на отдельный трек. Треки сохранятся как
            плейлист и будут играть прямо из SoundCloud.
          </p>
          <input
            className="input"
            placeholder="https://soundcloud.com/user/sets/… или https://soundcloud.com/user/likes"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            disabled={busy}
          />
          <div className="modal-actions">
            <button className="btn primary" disabled={busy || !link.trim()} onClick={runSoundcloud}>
              {busy ? <Loader2 size={16} className="spin" /> : null} Импортировать
            </button>
          </div>
        </>
      )}
      {(tab === "vk" || tab === "yandex") && (
        <>
          <p className="muted">
            {tab === "vk"
              ? "Загрузит всю «Мою музыку» из ВКонтакте в новый плейлист. Нужен вход во ВКонтакте в настройках."
              : "Загрузит «Мне нравится» из Яндекс Музыки в новый плейлист. Нужен вход в Яндекс в настройках."}
          </p>
          <div className="modal-actions">
            <button className="btn primary" disabled={busy} onClick={() => runService(tab)}>
              {busy ? <Loader2 size={16} className="spin" /> : null} Импортировать
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

function TrackInfo({ track }: { track: import("../lib/types").Track }) {
  const dl = useLibrary((s) => s.downloads[track.id]);
  return (
    <Shell title="О треке">
      <div className="row gap">
        <Cover src={track.cover} size={120} radius={10} />
        <div className="info-grid">
          <span className="muted">Название</span>
          <span>{track.title}</span>
          <span className="muted">Исполнитель</span>
          <span>{track.artist}</span>
          {track.album && (
            <>
              <span className="muted">Альбом</span>
              <span>{track.album}</span>
            </>
          )}
          <span className="muted">Длительность</span>
          <span>{fmtTime(track.duration)}</span>
          <span className="muted">Источник</span>
          <span>{sourceName(track.source)}</span>
          {dl && (
            <>
              <span className="muted">Файл</span>
              <span className="small break">{dl.path}</span>
            </>
          )}
        </div>
      </div>
      {track.link && (
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => openUrl(track.link!)}>
            Открыть в {sourceName(track.source)}
          </button>
        </div>
      )}
    </Shell>
  );
}

export function Modals() {
  const modal = useUi((s) => s.modal);
  if (!modal) return null;
  switch (modal.type) {
    case "addToPlaylist":
      return <AddToPlaylist tracks={modal.tracks} />;
    case "createPlaylist":
      return (
        <NameModal
          title="Новый плейлист"
          initial=""
          onSubmit={(name) => {
            const id = useLibrary.getState().createPlaylist(name, modal.tracks ?? []);
            if (modal.tracks?.length) toast("Плейлист создан", "success");
            else useUi.getState().go({ name: "playlist", id });
          }}
        />
      );
    case "renamePlaylist": {
      const p = useLibrary.getState().playlists.find((x) => x.id === modal.id);
      return <NameModal title="Переименовать" initial={p?.name ?? ""} onSubmit={(n) => useLibrary.getState().renamePlaylist(modal.id, n)} />;
    }
    case "equalizer":
      return <Equalizer />;
    case "import":
      return <ImportModal />;
    case "trackInfo":
      return <TrackInfo track={modal.track} />;
  }
}
