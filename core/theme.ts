import { cookies } from 'next/headers'

// Theme and sidebar width are the two things that must be right on the very
// first paint, so they live in cookies and are read on the server. The client
// changes them itself afterwards, in core/theme-client.ts, so a tap on either
// control never waits on a server round trip.

/** `system` follows the device: <html> carries no data-theme and the CSS
 * color-scheme resolves light-dark() from prefers-color-scheme. */
export type Theme = 'dark' | 'light' | 'system'

/** An absent or unrecognised cookie follows the device. */
export async function getTheme(): Promise<Theme> {
  const value = (await cookies()).get('pos_theme')?.value
  return value === 'light' || value === 'dark' ? value : 'system'
}

export async function getSidebarCollapsed(): Promise<boolean> {
  return (await cookies()).get('pos_sidebar')?.value === 'collapsed'
}
