// Sharing dates are entered and displayed in Korean time, regardless of device timezone.
export function koreaLocalToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}:00+09:00`);
  if (!Number.isFinite(timestamp)) return null;
  if (new Date(timestamp + 9 * 3600000).toISOString().slice(0, 16) !== value) return null;
  return new Date(timestamp).toISOString();
}

export function parseShareExpiry(value: unknown, now = Date.now()): number | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (input.expiresAt !== undefined) {
    if (input.hours !== undefined || typeof input.expiresAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expiresAt)) return null;
    const timestamp = Date.parse(input.expiresAt);
    if (!Number.isFinite(timestamp) || timestamp <= now || new Date(timestamp).toISOString() !== input.expiresAt) return null;
    return timestamp;
  }
  const hours = input.hours === undefined ? 1 : input.hours;
  return typeof hours === "number" && [1, 6, 12, 24].includes(hours) ? now + hours * 3600000 : null;
}

export const formatShareDate = (value: string) =>
  new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

// Longer deadlines are handled by the existing 30-second server checks until
// close enough for a browser timeout. Avoid the ~25-day setTimeout overflow.
export function shareExpiryDelay(expiresAt: string, now = Date.now()): number | null {
  const remaining = Math.max(0, Date.parse(expiresAt) - now);
  return remaining <= 2147483647 ? remaining : null;
}
