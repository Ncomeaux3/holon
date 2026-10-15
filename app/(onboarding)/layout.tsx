import { requireOwner } from '@/core/auth'
import { ToastProvider } from '@/components/pos'

// The wizard stands alone: no rail, no tab bar, no palette. Its own rail is
// the six steps, and the artboard draws nothing else around it.
export default async function OnboardingLayout({ children }: LayoutProps<'/'>) {
  await requireOwner()
  return (
    <ToastProvider>
      <main className="min-w-0 flex-1 p-[18px] md:p-7">{children}</main>
    </ToastProvider>
  )
}
