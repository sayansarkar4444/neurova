import { AUTH_COOKIE_NAME } from "./auth";

const FALLBACK_USER_ID = "anonymous";

function sanitizeUserId(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const cleaned = candidate.trim();
  if (!cleaned) return null;
  if (!/^[a-zA-Z0-9._:@-]{1,140}$/.test(cleaned)) return null;
  return cleaned;
}

function parseCookieValue(cookieHeader: string, key: string): string | null {
  const parts = cookieHeader.split(";").map((item) => item.trim());
  for (const part of parts) {
    if (!part.startsWith(`${key}=`)) continue;
    const raw = part.slice(key.length + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function getRequestUserId(request: Request): string {
  const headerUserId = sanitizeUserId(request.headers.get("x-neurova-user-id"));
  if (headerUserId) return headerUserId;

  const cookieHeader = request.headers.get("cookie");
  const cookieUserId = cookieHeader
    ? sanitizeUserId(parseCookieValue(cookieHeader, AUTH_COOKIE_NAME))
    : null;
  if (cookieUserId) return cookieUserId;

  return FALLBACK_USER_ID;
}
