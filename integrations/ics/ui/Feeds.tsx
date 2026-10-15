import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ActionButton, Eyebrow, fieldClass } from '@/components/pos'
import { requireOwner } from '@/core/auth'
import { getCredentials, updateCredentials } from '@/core/credentials'
import { normaliseUrl } from '@/core/fetching'
import { feedUrls, httpUrl } from '../client'

// Which published calendars the nightly pull reads. Kept in the connection's
// own credentials beside the first one, so the list leaves with a disconnect,
// the way Google's picked calendars do.

async function save(formData: FormData) {
  'use server'
  await requireOwner()
  const creds = await getCredentials('ics')
  if (!creds) return

  const urls = feedUrls(creds)
  const removing = String(formData.get('remove') ?? '')
  const adding = String(formData.get('add') ?? '').trim()
  const next = urls.filter((u) => u !== removing)

  if (!removing) {
    // Checked here rather than left to fail as a pull at 3am: the same rules
    // the fetch itself applies, so a typo is refused where it was typed.
    let url: string
    try {
      url = normaliseUrl(httpUrl(adding))
    } catch (error) {
      const why = error instanceof Error ? error.message : 'That is not a calendar URL.'
      redirect(`/settings/connections?error=${encodeURIComponent(why)}`)
    }
    if (!next.includes(url)) next.push(url)
  }

  await updateCredentials('ics', { ...creds, urls: JSON.stringify(next) })
  revalidatePath('/settings/connections')
}

export async function Feeds() {
  const urls = feedUrls(await getCredentials('ics'))

  return (
    <div className="mt-2.5 flex flex-col gap-2.5 rounded-card bg-fill-3 px-4 py-3">
      <Eyebrow>Calendars</Eyebrow>
      {urls.map((url) => (
        <form key={url} action={save} className="flex items-center justify-between gap-2.5">
          <input type="hidden" name="remove" value={url} />
          {/* Wraps rather than truncates: two iCloud URLs differ near the end. */}
          <span className="num min-w-0 break-all text-footnote text-label">{url}</span>
          {/* Named after its own URL: two buttons both called Remove say
              nothing to a screen reader about which calendar they drop. */}
          <ActionButton type="submit" variant="quiet" className="shrink-0" aria-label={`Remove ${url}`}>
            Remove
          </ActionButton>
        </form>
      ))}
      <form action={save} className="flex flex-col gap-2">
        <label className="flex flex-col gap-2">
          <Eyebrow>Add a calendar</Eyebrow>
          <input
            name="add"
            type="text"
            required
            inputMode="url"
            placeholder="webcal://p01-calendars.icloud.com/published/2/..."
            autoComplete="off"
            className={`${fieldClass} num`}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2.5">
          <ActionButton type="submit">Add calendar</ActionButton>
          <span className="text-footnote text-label/70">Next sync reads the new list</span>
        </div>
      </form>
    </div>
  )
}
