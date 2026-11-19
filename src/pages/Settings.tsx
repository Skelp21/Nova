import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, FolderOpen, KeyRound, LogIn, LogOut } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, errText } from "../lib/api";
import { SOURCES, type AccountsStatus, type Source } from "../lib/types";
import { ACCENTS, THEMES, useSettings } from "../store/settings";
import { AccountCard } from "../components/AccountCard";
import { isMobile } from "../lib/platform";
import { toast, useUi } from "../store/ui";

const TABS = [
  { id: "accounts", name: "Аккаунт" },
  { id: "appearance", name: "Внешний вид" },
  { id: "playback", name: "Воспроизведение" },
  { id: "downloads", name: "Загрузки" },
  { id: "integrations", name: "Интеграции" },
  { id: "hotkeys", name: "Горячие клавиши" },
  { id: "about", name: "О программе" },
];

function Row({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="grow">
        <div>{title}</div>
        {desc && <div className="muted small">{desc}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

function ServiceCard({ provider, status }: { provider: "vk" | "yandex"; status: AccountsStatus | null }) {
  const [manual, setManual] = useState(isMobile);
  const [token, setToken] = useState("");
  const connected = provider === "vk" ? status?.vk : status?.yandex;
  const who = provider === "vk" ? status?.vkUserId && `id${status.vkUserId}` : status?.yandexLogin;
  const info = SOURCES.find((s) => s.id === provider)!;
  return (
    <div className="account-card">
      <div className="row gap">
        <span className="src-dot" style={{ background: info.color }} />
        <div className="grow">
          <div className="strong">{info.name}</div>
          <div className="muted small">{connected ? `Подключено${who ? ` · ${who}` : ""}` : "Не подключено"}</div>
        </div>
        {connected ? (
          <button className="btn ghost small" onClick={() => api.authLogout(provider)}>
            <LogOut size={14} /> Выйти
          </button>
        ) : (
          <>
            <button className="btn ghost small" onClick={() => setManual(!manual)} title="Ввести токен вручную">
              <KeyRound size={14} />
            </button>
            {!isMobile && (
              <button className="btn primary small" onClick={() => api.authLogin(provider).catch((e) => toast(errText(e), "error"))}>
                <LogIn size={14} /> Войти
              </button>
            )}
          </>
        )}
      </div>
      {!connected && manual && (
        <div className="row gap mt">
          <input className="input" placeholder="access_token" value={token} onChange={(e) => setToken(e.target.value)} />
          <button
            className="btn primary small"
            onClick={() =>
              api
                .authSetToken(provider, token)
                .then(() => {
                  setToken("");
                  setManual(false);
                  toast("Подключено", "success");
                })
                .catch((e) => toast(errText(e), "error"))
            }
          >
            Сохранить
          </button>
        </div>
      )}
      <div className="muted small mt">
        {provider === "vk"
          ? "Вход через официальное окно ВКонтакте. Для музыки используется доступ клиента Kate Mobile."
          : "Вход через официальное окно Яндекса. Для полных треков нужна подписка Яндекс Плюс."}
      </div>
    </div>
  );
}

export function SettingsPage({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useState(initial ?? "accounts");
  const s = useSettings();
  const [status, setStatus] = useState<AccountsStatus | null>(null);

  useEffect(() => {
    if (initial) setTab(initial);
  }, [initial]);

  useEffect(() => {
    const refresh = () => api.accountsStatus().then(setStatus).catch(() => {});
    refresh();
    const un = listen("accounts-changed", refresh);
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!s.downloadDir) api.defaultDownloadDir().then((d) => s.set({ downloadDir: d }));
  }, []);

  return (
    <div className="page settings">
      <h1>Настройки</h1>
      <div className="tabs big">
        {TABS.filter((t) => !isMobile || !["integrations", "hotkeys"].includes(t.id)).map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.name}
          </button>
        ))}
      </div>

      {tab === "accounts" && (
        <>
          <AccountCard />
          <h3>Музыкальные сервисы</h3>
          <ServiceCard provider="vk" status={status} />
          <ServiceCard provider="yandex" status={status} />
          <h3>Источники поиска</h3>
          {SOURCES.map((src) => (
            <Row key={src.id} title={src.name} desc={src.needsAuth ? "Нужен вход" : "Работает без входа"}>
              <Switch
                checked={s.enabledSources[src.id]}
                onChange={(v) => s.set({ enabledSources: { ...s.enabledSources, [src.id as Source]: v } })}
              />
            </Row>
          ))}
          <div className="row gap mt">
            <button className="btn ghost" onClick={() => useUi.getState().openModal({ type: "import" })}>
              Перенести музыку из Spotify, Apple Music, SoundCloud, ВК, Яндекса
            </button>
          </div>
        </>
      )}

      {tab === "appearance" && (
        <>
          <h3>Тема</h3>
          <div className="theme-grid">
            {THEMES.map((t) => (
              <button key={t.id} className={`theme-card ${s.theme === t.id ? "on" : ""}`} onClick={() => s.set({ theme: t.id })} style={{ background: t.bg, color: t.fg }}>
                <div className="theme-preview" style={{ background: t.card }}>
                  <i style={{ background: s.accent }} />
                  <b style={{ background: t.fg }} />
                </div>
                <span>{t.name}</span>
                {s.theme === t.id && <Check size={14} className="theme-check" />}
              </button>
            ))}
          </div>
          <h3>Акцентный цвет</h3>
          <div className="row gap wrap">
            {ACCENTS.map((c) => (
              <button key={c} className={`swatch ${s.accent === c ? "on" : ""}`} style={{ background: c }} onClick={() => s.set({ accent: c })} />
            ))}
            <label className="swatch custom" title="Свой цвет">
              <input type="color" value={s.accent} onChange={(e) => s.set({ accent: e.target.value })} />
            </label>
          </div>
          <Row title="Фон по обложке" desc="Размытая обложка текущего трека за интерфейсом">
            <Switch checked={s.coverBackdrop} onChange={(v) => s.set({ coverBackdrop: v })} />
          </Row>
          <Row title="Компактные строки" desc="Больше треков на экране">
            <Switch checked={s.compactRows} onChange={(v) => s.set({ compactRows: v })} />
          </Row>
        </>
      )}

      {tab === "playback" && (
        <>
          <Row title="Эквалайзер" desc="10 полос, пресеты и свои настройки">
            <button className="btn ghost small" onClick={() => useUi.getState().openModal({ type: "equalizer" })}>
              Открыть
            </button>
          </Row>
          <Row title="Скорость воспроизведения" desc={`${s.rate}× (высота тона сохраняется)`}>
            <input type="range" min={0.5} max={2} step={0.05} value={s.rate} onChange={(e) => s.set({ rate: parseFloat(e.target.value) })} />
          </Row>
          <Row title="Пропускать «Не нравится» в волне" desc="Треки с дизлайком не попадут в «Мою волну»">
            <Switch checked={s.waveSkipDisliked} onChange={(v) => s.set({ waveSkipDisliked: v })} />
          </Row>
          <Row title="YouTube через yt-dlp" desc="Если YouTube перестанет отдавать поток, установите yt-dlp в PATH — Yarvi подхватит его сама">
            <button className="btn ghost small" onClick={() => openUrl("https://github.com/yt-dlp/yt-dlp/releases/latest")}>
              Скачать yt-dlp
            </button>
          </Row>
        </>
      )}

      {tab === "downloads" && (
        <>
          <Row title="Папка для музыки" desc={s.downloadDir || "…"}>
            {!isMobile && <button
              className="btn ghost small"
              onClick={async () => {
                const dir = await open({ directory: true, defaultPath: s.downloadDir || undefined });
                if (typeof dir === "string") s.set({ downloadDir: dir });
              }}
            >
              <FolderOpen size={14} /> Выбрать
            </button>}
          </Row>
          <p className="muted small">
            Скачанные треки сохраняются обычными файлами (mp3 / m4a / webm) и играют без интернета. HLS-потоки ВКонтакте расшифровываются и
            собираются в один файл.
          </p>
        </>
      )}

      {tab === "integrations" && (
        <>
          <Row title="Discord Rich Presence" desc="Показывать в Discord, что вы слушаете">
            <Switch checked={s.discord.enabled} onChange={(v) => s.set({ discord: { ...s.discord, enabled: v } })} />
          </Row>
          <Row
            title="Application ID"
            desc={
              <>
                Создайте приложение на{" "}
                <span className="link" onClick={() => openUrl("https://discord.com/developers/applications")}>
                  discord.com/developers
                </span>{" "}
                и вставьте его ID
              </>
            }
          >
            <input
              className="input"
              style={{ width: 220 }}
              value={s.discord.clientId}
              placeholder="123456789012345678"
              onChange={(e) => s.set({ discord: { ...s.discord, clientId: e.target.value.replace(/\D/g, "") } })}
            />
          </Row>
          <Row title="Мини-плеер" desc="Маленькое окно поверх всех окон">
            <button className="btn ghost small" onClick={() => api.openMiniplayer()}>
              Открыть
            </button>
          </Row>
          <Row title="Медиаклавиши и панель Windows" desc="Работают автоматически через системную панель мультимедиа">
            <Check size={16} className="accent-text" />
          </Row>
        </>
      )}

      {tab === "hotkeys" && (
        <div className="hotkeys">
          {[
            ["Пробел", "Пауза / воспроизведение"],
            ["Ctrl + → / ←", "Следующий / предыдущий трек"],
            ["→ / ←", "Перемотка на 5 секунд"],
            ["↑ / ↓", "Громкость"],
            ["M", "Выключить звук"],
            ["L", "Мне нравится"],
            ["Ctrl + F", "Поиск"],
            ["Медиаклавиши", "Работают даже когда окно свёрнуто"],
          ].map(([k, v]) => (
            <div key={k} className="hotkey">
              <kbd>{k}</kbd>
              <span>{v}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "about" && (
        <div className="about">
          <img src="/logo.svg" width={64} height={64} />
          <h2>Yarvi 0.1.0</h2>
          <p className="muted">
            Агрегатор музыки: YouTube Music, SoundCloud, ВКонтакте и Яндекс Музыка в одном плеере. Без рекламы, без серверов — всё хранится у
            вас на компьютере.
          </p>
        </div>
      )}
    </div>
  );
}
