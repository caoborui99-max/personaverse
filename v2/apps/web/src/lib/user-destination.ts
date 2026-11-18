// Canonicalize once before checking route boundaries. Reject residual encodings rather than
// allowing the browser/router to interpret a second decoding differently.
export function safeUserDestination(value: string | null, origin: string): string {
  const fallback = '/account';
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return fallback;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return fallback;
    const decoded = decodeURIComponent(url.pathname);
    if (
      decoded.includes('%') ||
      decoded.startsWith('//') ||
      /[\\\u0000-\u0020\u007f]/.test(decoded)
    )
      return fallback;
    const canonical = new URL(decoded, origin);
    if (
      canonical.origin !== origin ||
      /^\/(?:admin|auth|login|register|verify-email|reset-password|forgot-password)(?:\/|$)/i.test(
        canonical.pathname,
      )
    )
      return fallback;
    return canonical.pathname + url.search;
  } catch {
    return fallback;
  }
}
