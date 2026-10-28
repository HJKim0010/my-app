import "server-only";
import { createClient } from "@supabase/supabase-js";

export const privateHeaders = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
export const sessionCookieName = () => process.env.NODE_ENV === "production" ? "__Host-history-session" : "history-session";

export function authConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.HISTORY_ADMIN_EMAIL?.trim());
}

export function allowedEmail(email: unknown): boolean {
  const allowed = process.env.HISTORY_ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(allowed && typeof email === "string" && email.trim().toLowerCase() === allowed);
}

// Fresh client per request: never share an authenticated SDK session between users.
export function authClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(10000) }) },
  });
}

export function readSession(request: Request): string {
  const prefix = `${sessionCookieName()}=`;
  const cookie = request.headers.get("cookie")?.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  if (!cookie) return "";
  try { return decodeURIComponent(cookie.slice(prefix.length)); } catch { return ""; }
}

export function sessionCookie(token: string, maxAge: number): string {
  return `${sessionCookieName()}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.min(3600, Math.floor(maxAge)))}` +
    (process.env.NODE_ENV === "production" ? "; Secure" : "");
}

export function sameOrigin(request: Request, required = false): boolean {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (!origin) return !required;
  // Next.js may normalize request.url to localhost while the browser uses
  // 127.0.0.1. Host is the actual destination; do not trust forwarded-host here.
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  return origin === `${url.protocol}//${host}`;
}

export async function verifiedAdmin(token: string): Promise<{ email: string } | null> {
  if (!token || token.length > 8192 || !authConfigured()) return null;
  try {
    // Ask Supabase to verify the token; decoding a cookie/JWT is not authorization.
    const { data, error } = await authClient().auth.getUser(token);
    if (error || !data.user?.email_confirmed_at || !allowedEmail(data.user.email)) return null;
    return { email: data.user.email! };
  } catch { return null; }
}
