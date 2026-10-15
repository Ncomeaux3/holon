// Posts a render failure to /api/client-error from the two error boundaries.
// Fire and forget: a boundary that itself failed to report must still render
// Try again, so nothing here throws or is awaited.
export function reportClientError(error: Error & { digest?: string }): void {
  try {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        route: (window.location.pathname + window.location.search).slice(0, 500),
        digest: error.digest,
        message: error.message || error.name || 'Unknown error',
        stack: error.stack?.slice(0, 20_000),
      }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Off the page entirely (no fetch, no window): nothing to report to.
  }
}
