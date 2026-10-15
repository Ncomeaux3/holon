// The name a passkey is stored under when it is made. Supabase keeps a
// friendly_name and nothing about the authenticator, so the browser that ran
// the ceremony is the record of where a passkey came from. Pure, so it is
// testable without a browser.

/**
 * "Safari on iPhone", "Chrome on Mac". Read from the user agent at enrolment.
 *
 * ponytail: substring checks, not a UA parser. iPadOS Safari reports itself
 * as a Mac and reads as one here; a parser library would not know better.
 */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent

  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser'

  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : null

  return device ? `${browser} on ${device}` : browser
}
