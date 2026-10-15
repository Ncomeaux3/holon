import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { getSidebarCollapsed, getTheme } from '@/core/theme'
import './globals.css'

// Geist, one family, served from the repo under its OFL licence (app/fonts).
// The Latin subset is a variable font, so the whole weight range is one file.
const geist = localFont({
  src: './fonts/Geist-Latin.woff2',
  weight: '100 900',
  variable: '--font-geist',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Holon',
  description: 'Your life. One system.',
  // iOS reads the startup image at install and only for an exact size match,
  // so this is one phone (iPhone 16 Pro Max, 440 x 956 at 3x) and no
  // other. Android takes its splash from the manifest.
  appleWebApp: {
    capable: true,
    title: 'Holon',
    statusBarStyle: 'black-translucent',
    startupImage: [
      {
        url: '/splash/iphone-16-pro-max.png',
        media: '(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3)',
      },
    ],
  },
}

const CANVAS = { light: '#F2F2F7', dark: '#000000' }

// The address bar matches the page ground of the theme that is actually
// rendered: a forced theme gives one colour, system gives the media pair.
export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme()
  return {
    // Cover, so env(safe-area-inset-*) reads the home indicator instead of zero.
    viewportFit: 'cover',
    themeColor:
      theme === 'system'
        ? [
            { media: '(prefers-color-scheme: dark)', color: CANVAS.dark },
            { media: '(prefers-color-scheme: light)', color: CANVAS.light },
          ]
        : CANVAS[theme],
  }
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Written on the server so the first paint is already the right theme.
  // System is the absence of the attribute: the stylesheet's color-scheme then
  // follows the device and the dark: variant matches through the media query.
  // The rail width is read here too: the desktop Collapse toggle sets it on
  // this element directly (Sidebar.tsx), so the first paint and every later
  // toggle share the one CSS variable with no server round trip between them.
  const [theme, collapsed] = await Promise.all([getTheme(), getSidebarCollapsed()])

  return (
    <html
      lang="en"
      data-theme={theme === 'system' ? undefined : theme}
      style={{ ['--rail' as string]: collapsed ? '72px' : '232px' }}
      className={`${geist.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
