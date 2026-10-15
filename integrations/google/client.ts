import { freshCredentials } from '@/core/credentials'
import type { Credentials } from '@/core/integration-contract'

// Google Calendar's and Gmail's read APIs, and the token refresh they need.
// Access tokens last an hour, so every call goes through freshCredentials,
// which refreshes one that is about to lapse and stores the new one.

const API = 'https://www.googleapis.com/calendar/v3'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

export class GoogleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleError'
  }
}

/**
 * A readable sentence for a failed response. Google answers with JSON whose
 * message is written for developers, so a refused token gets a sentence of
 * our own and anything else gets Google's message without the envelope.
 */
async function failure(res: Response, what: string): Promise<GoogleError> {
  const text = await res.text()
  // 401 from the API, or invalid_grant from the token endpoint: the grant is
  // gone. Any other 400 is a bad request and keeps Google's own message.
  if (res.status === 401 || /"error":\s*"invalid_grant"/.test(text)) {
    return new GoogleError(res.status, 'Google refused the token. Reauthorize Google to fix it.')
  }
  // A grant from before Phase 7c holds calendar.readonly only.
  if (res.status === 403 && /insufficient.*scope/i.test(text)) {
    return new GoogleError(res.status, 'Google has not granted Gmail. Reconnect Google to add it.')
  }
  if (res.status === 403 && /has not been used in project|is disabled/i.test(text)) {
    return new GoogleError(res.status, 'The Gmail API is not enabled in the Google Cloud project. Enable it, then Reconnect Google.')
  }
  let message = text
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string }
    message = body.error_description ?? (typeof body.error === 'string' ? body.error : body.error?.message) ?? text
  } catch {
    // Not JSON: the text as sent.
  }
  return new GoogleError(res.status, `${what} ${res.status}: ${message.slice(0, 160)}`)
}

/** A refresh_token grant. Form encoded: Google's token endpoint takes nothing else. */
export async function refreshGoogle(creds: Credentials): Promise<Credentials> {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    throw new GoogleError(0, 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set, so the token cannot refresh.')
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: creds.refresh_token ?? '',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw await failure(res, 'Google refresh')

  const body = (await res.json()) as { access_token: string; expires_in: number }
  return {
    access_token: body.access_token,
    expires_at: String(Math.floor(Date.now() / 1000) + body.expires_in),
  }
}

/** The stored credentials with a current access token, or null when not connected. */
export function googleCredentials(): Promise<Credentials | null> {
  return freshCredentials('google', refreshGoogle)
}

async function get<T>(path: string, token: string, base = API): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw await failure(res, 'Google')
  return (await res.json()) as T
}

export type GoogleCalendar = {
  id: string
  summary: string
  primary?: boolean
  /** Ticked in Google Calendar's own sidebar. */
  selected?: boolean
}

export async function calendars(token: string): Promise<GoogleCalendar[]> {
  // ponytail: one page of 250; paging when someone subscribes to more calendars than that.
  const body = await get<{ items?: GoogleCalendar[] }>('/users/me/calendarList?maxResults=250', token)
  return body.items ?? []
}

type When = { date?: string; dateTime?: string }

export type GoogleEvent = {
  id: string
  status?: string
  summary?: string
  location?: string
  htmlLink?: string
  start: When
  end?: When
}

/** Every event in the window, recurring ones expanded into their instances. */
export async function events(calendarId: string, timeMin: Date, timeMax: Date, token: string): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = []
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '2500',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      ...(pageToken && { pageToken }),
    })
    const body = await get<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      `/calendars/${encodeURIComponent(calendarId)}/events?${qs}`,
      token,
    )
    out.push(...(body.items ?? []))
    pageToken = body.nextPageToken
  } while (pageToken)
  return out
}

/**
 * The calendar ids to pull: the owner's pick from the Connections card, or,
 * before one is made, whatever is ticked in Google Calendar itself.
 */
export function pickedIds(creds: Credentials, all: GoogleCalendar[]): string[] {
  if (creds.calendars) return JSON.parse(creds.calendars) as string[]
  return all.filter((c) => c.selected || c.primary).map((c) => c.id)
}

/** The Gmail label the owner files mail under for POS to read. Nothing else in the mailbox is listed. */
export const GMAIL_LABEL = 'POS'

export type GmailPart = {
  mimeType: string
  filename?: string
  headers?: { name: string; value: string }[]
  /** base64url. An attachment carries only attachmentId until fetched. */
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: GmailPart[]
}

export type GmailMessage = { id: string; snippet?: string; payload: GmailPart }

/** Ids of the labelled messages from the last `days`, newest first. */
export async function gmailMessageIds(token: string, days = 30): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({
      q: `label:${GMAIL_LABEL} newer_than:${days}d`,
      maxResults: '100',
      ...(pageToken && { pageToken }),
    })
    const body = await get<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${qs}`, token, GMAIL)
    ids.push(...(body.messages ?? []).map((m) => m.id))
    pageToken = body.nextPageToken
  } while (pageToken)
  return ids
}

function walk(part: GmailPart): GmailPart[] {
  return [part, ...(part.parts ?? []).flatMap(walk)]
}

/** One message, with any calendar attachment's bytes fetched into its part. */
export async function gmailMessage(token: string, id: string): Promise<GmailMessage> {
  const msg = await get<GmailMessage>(`/messages/${id}?format=full`, token, GMAIL)
  for (const part of walk(msg.payload)) {
    const calendar = part.mimeType === 'text/calendar' || /\.ics$/i.test(part.filename ?? '')
    if (calendar && !part.body?.data && part.body?.attachmentId) {
      const att = await get<{ data: string }>(`/messages/${id}/attachments/${part.body.attachmentId}`, token, GMAIL)
      part.body = { ...part.body, data: att.data }
    }
  }
  return msg
}

/** Whether the label exists: the Connections test's answer to "will anything arrive". */
export async function hasGmailLabel(token: string): Promise<boolean> {
  const body = await get<{ labels?: { name: string }[] }>('/labels', token, GMAIL)
  return (body.labels ?? []).some((l) => l.name === GMAIL_LABEL)
}
