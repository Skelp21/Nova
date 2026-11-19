/**
 * Minimal Supabase client (Auth + one table) over plain fetch.
 * Table `libraries`: one row per user with the whole synced library as JSON.
 */

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
  userId: string;
  email: string;
}

export interface RemoteLibrary {
  data: unknown;
  updatedAt: string;
}

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/** Built-in project from .env, or one entered in Settings. */
export function cloudConfig(): CloudConfig | null {
  const url = (env.VITE_SUPABASE_URL || localStorage.getItem("nota-cloud-url") || "").trim().replace(/\/+$/, "");
  const anonKey = (env.VITE_SUPABASE_ANON_KEY || localStorage.getItem("nota-cloud-key") || "").trim();
  return url && anonKey ? { url, anonKey } : null;
}

export const cloudBuiltIn = () => !!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);

export function setCloudConfig(url: string, anonKey: string) {
  localStorage.setItem("nota-cloud-url", url.trim());
  localStorage.setItem("nota-cloud-key", anonKey.trim());
}

function need(): CloudConfig {
  const c = cloudConfig();
  if (!c) throw new Error("Облако не настроено: укажите адрес и ключ Supabase в настройках");
  return c;
}

/** Turns Supabase error payloads into readable Russian messages. */
function explain(status: number, body: Record<string, unknown>): string {
  const raw = String(body.error_description || body.msg || body.message || body.error || `HTTP ${status}`);
  const map: [RegExp, string][] = [
    [/invalid login credentials/i, "Неверная почта или пароль"],
    [/email not confirmed/i, "Почта не подтверждена — откройте письмо от Supabase"],
    [/user already registered/i, "Такой аккаунт уже есть — войдите"],
    [/password should be at least/i, "Пароль слишком короткий (минимум 6 символов)"],
    [/unable to validate email|invalid email/i, "Неверный адрес почты"],
    [/rate limit/i, "Слишком много попыток, подождите минуту"],
  ];
  for (const [re, ru] of map) if (re.test(raw)) return ru;
  return raw;
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const c = need();
  const headers = new Headers(init.headers);
  headers.set("apikey", c.anonKey);
  headers.set("Authorization", `Bearer ${init.token ?? c.anonKey}`);
  if (init.body) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(`${c.url}${path}`, { ...init, headers });
  } catch {
    throw new Error("Нет связи с облаком");
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(explain(res.status, body));
  return body as T;
}

interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: { id: string; email: string };
  id?: string;
}

function toSession(r: AuthResponse): Session | null {
  if (!r.access_token || !r.refresh_token || !r.user) return null;
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (r.expires_in ?? 3600),
    userId: r.user.id,
    email: r.user.email,
  };
}

export async function signIn(email: string, password: string): Promise<Session> {
  const r = await call<AuthResponse>("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email: email.trim(), password }),
  });
  const s = toSession(r);
  if (!s) throw new Error("Облако не выдало сессию");
  return s;
}

/** Returns null when the project requires e-mail confirmation first. */
export async function signUp(email: string, password: string): Promise<Session | null> {
  const r = await call<AuthResponse>("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({ email: email.trim(), password }),
  });
  return toSession(r);
}

export async function refresh(s: Session): Promise<Session> {
  const r = await call<AuthResponse>("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: s.refreshToken }),
  });
  const n = toSession(r);
  if (!n) throw new Error("Сессия истекла — войдите снова");
  return n;
}

export async function signOut(s: Session) {
  await call("/auth/v1/logout", { method: "POST", token: s.accessToken }).catch(() => {});
}

export async function pullLibrary(s: Session): Promise<RemoteLibrary | null> {
  const rows = await call<{ data: unknown; updated_at: string }[]>(
    `/rest/v1/libraries?select=data,updated_at&user_id=eq.${s.userId}`,
    { token: s.accessToken },
  );
  return rows[0] ? { data: rows[0].data, updatedAt: rows[0].updated_at } : null;
}

export async function pushLibrary(s: Session, data: unknown): Promise<string> {
  const updatedAt = new Date().toISOString();
  await call("/rest/v1/libraries?on_conflict=user_id", {
    method: "POST",
    token: s.accessToken,
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: s.userId, data, updated_at: updatedAt }),
  });
  return updatedAt;
}
