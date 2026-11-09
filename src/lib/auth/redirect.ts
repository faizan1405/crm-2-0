const BLOCKED_REDIRECT_PREFIXES = ["/login", "/api/", "/api", "/_serverFn", "//"] as const;

/**
 * Accepts only same-origin relative CRM paths so open redirects (`https://...`, `//evil.com`,
 * `\\evil.com`, control characters) always fall back safely to `/`.
 */
export function sanitizeRedirectTarget(rawTarget: string | null | undefined): string {
  if (!rawTarget || typeof rawTarget !== "string") return "/";
  const trimmed = rawTarget.trim();
  if (!trimmed.startsWith("/")) return "/";
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\") || trimmed.includes("\\")) return "/";
  // Reject ASCII control characters, newlines, or whitespace tricks.
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return "/";
  }

  try {
    const parsed = new URL(trimmed, "http://127.0.0.1");
    if (parsed.origin !== "http://127.0.0.1") return "/";
    const normalizedPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    for (const prefix of BLOCKED_REDIRECT_PREFIXES) {
      if (normalizedPath === prefix || normalizedPath.startsWith(prefix)) {
        return "/";
      }
    }
    return normalizedPath || "/";
  } catch {
    return "/";
  }
}
