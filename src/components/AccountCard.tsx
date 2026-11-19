import { Cloud, CloudOff, Loader2, LogOut, RefreshCw } from "lucide-react";
import { useState } from "react";
import { cloudBuiltIn, cloudConfig, setCloudConfig } from "../lib/cloud";
import { useAccount } from "../store/account";
import { toast } from "../store/ui";

function since(ts: number | null): string {
  if (!ts) return "ещё не было";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "только что";
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function CloudSetup({ onDone }: { onDone: () => void }) {
  const cur = cloudConfig();
  const [url, setUrl] = useState(cur?.url ?? "");
  const [key, setKey] = useState(cur?.anonKey ?? "");
  return (
    <div className="stack">
      <div className="muted small">
        Укажите проект Supabase (Project Settings → API). Один раз на каждом устройстве — или впишите их в файл <code>.env</code> перед сборкой,
        тогда вводить не придётся.
      </div>
      <input className="input" placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
      <input className="input" placeholder="anon public key" value={key} onChange={(e) => setKey(e.target.value)} />
      <div className="row gap">
        <button
          className="btn primary small"
          disabled={!url.trim() || !key.trim()}
          onClick={() => {
            setCloudConfig(url, key);
            toast("Облако настроено", "success");
            onDone();
          }}
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}

export function AccountCard() {
  const { session, status, error, lastSyncAt, login, logout, syncNow } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [editCloud, setEditCloud] = useState(false);
  const configured = !!cloudConfig();

  const submit = async (register: boolean) => {
    setBusy(true);
    const ok = await login(email, password, register);
    setBusy(false);
    if (ok) setPassword("");
  };

  return (
    <div className="account-card nota-account">
      <div className="row gap">
        {session ? <Cloud size={22} className="accent-text" /> : <CloudOff size={22} className="muted" />}
        <div className="grow">
          <div className="strong">Аккаунт Yarvi</div>
          <div className="muted small">
            {session
              ? `${session.email} · ${status === "syncing" ? "синхронизация…" : status === "error" ? "ошибка синхронизации" : `синхронизировано ${since(lastSyncAt)}`}`
              : "Войдите, чтобы плейлисты и «Мне нравится» были на всех ваших устройствах"}
          </div>
        </div>
        {session && (
          <>
            <button className="btn ghost small" onClick={() => syncNow()} disabled={status === "syncing"}>
              {status === "syncing" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Синхронизировать
            </button>
            <button className="btn ghost small" onClick={() => logout()}>
              <LogOut size={14} /> Выйти
            </button>
          </>
        )}
      </div>

      {session && error && <div className="hint error mt">{error}</div>}

      {!session && (!configured || editCloud) && (
        <div className="mt">
          <CloudSetup onDone={() => setEditCloud(false)} />
        </div>
      )}

      {!session && configured && !editCloud && (
        <div className="stack mt">
          <input className="input" type="email" autoComplete="email" placeholder="Почта" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="Пароль (минимум 6 символов)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit(false)}
          />
          <div className="row gap wrap">
            <button className="btn primary" disabled={busy || !email || password.length < 6} onClick={() => submit(false)}>
              {busy && <Loader2 size={16} className="spin" />} Войти
            </button>
            <button className="btn ghost" disabled={busy || !email || password.length < 6} onClick={() => submit(true)}>
              Создать аккаунт
            </button>
            {!cloudBuiltIn() && (
              <button className="text-btn" onClick={() => setEditCloud(true)}>
                Настройки облака
              </button>
            )}
          </div>
          <div className="muted small">
            При первом входе плейлисты с этого устройства объединятся с теми, что уже есть в аккаунте — ничего не потеряется.
          </div>
        </div>
      )}
    </div>
  );
}
