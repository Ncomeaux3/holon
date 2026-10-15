import { describe, expect, it } from 'vitest'

import { captionTracks, isYouTube, pickTrack, transcriptFromXml, videoId } from './youtube'

// SPEC asks for yt-dlp. It is a Python binary and Vercel's Node runtime cannot
// run one, so this reads the caption track list off the watch page instead.
// The endpoint is undocumented, so every parser here is written to return
// nothing rather than to throw or to guess.

describe('videoId', () => {
  it('reads the id out of every shape YouTube uses', () => {
    const id = 'dQw4w9WgXcQ'
    expect(videoId(`https://www.youtube.com/watch?v=${id}`)).toBe(id)
    expect(videoId(`https://youtube.com/watch?v=${id}&t=42s`)).toBe(id)
    expect(videoId(`https://youtu.be/${id}`)).toBe(id)
    expect(videoId(`https://www.youtube.com/embed/${id}`)).toBe(id)
    expect(videoId(`https://www.youtube.com/shorts/${id}`)).toBe(id)
    expect(videoId(`https://www.youtube.com/live/${id}`)).toBe(id)
  })

  // Not every YouTube URL is a video, and asking for captions on a channel
  // page returns a page rather than an error.
  it('returns null for a YouTube URL that is not a video', () => {
    expect(videoId('https://www.youtube.com/@someone')).toBeNull()
    expect(videoId('https://www.youtube.com/playlist?list=PL123')).toBeNull()
    expect(videoId('https://www.youtube.com/')).toBeNull()
  })

  it('returns null for anything else, including junk', () => {
    expect(videoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(videoId('not a url')).toBeNull()
    expect(videoId('')).toBeNull()
  })

  // The id is interpolated into a URL, so its shape is checked rather than
  // trusted.
  it('rejects an id that is not eleven characters of the right alphabet', () => {
    expect(videoId('https://youtu.be/short')).toBeNull()
    expect(videoId('https://youtu.be/waytoolongtobeanid')).toBeNull()
    expect(videoId('https://youtu.be/../../etc/pass')).toBeNull()
  })

  it('isYouTube agrees with videoId', () => {
    expect(isYouTube('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    expect(isYouTube('https://example.com')).toBe(false)
  })
})

describe('captionTracks', () => {
  const track = (over = {}) =>
    JSON.stringify({ baseUrl: 'https://x/api/timedtext?v=1', languageCode: 'en', ...over })

  it('finds the array inside the watch page blob', () => {
    const html = `<script>var x = {"captionTracks":[${track()}],"other":1};</script>`
    expect(captionTracks(html)).toHaveLength(1)
    expect(captionTracks(html)[0].baseUrl).toContain('timedtext')
  })

  // A caption track name can contain a bracket, and stopping at the first one
  // cuts the array in half and loses every track after it.
  it('is not fooled by a bracket inside a track name', () => {
    const html = `{"captionTracks":[${track({ name: 'English [auto]' })},${track({ languageCode: 'fr' })}]}`
    const tracks = captionTracks(html)
    expect(tracks).toHaveLength(2)
    expect(tracks[1].languageCode).toBe('fr')
  })

  it('is not fooled by an escaped quote inside a name', () => {
    const html = `{"captionTracks":[${track({ name: 'He said \\"hi\\"' })}]}`
    expect(captionTracks(html)).toHaveLength(1)
  })

  it('returns nothing rather than throwing when the page has no tracks', () => {
    expect(captionTracks('<html>a video with captions off</html>')).toEqual([])
    expect(captionTracks('{"captionTracks":[malformed')).toEqual([])
    expect(captionTracks('')).toEqual([])
  })
})

describe('pickTrack', () => {
  // Speech recognition is materially worse than a written track, so it is the
  // fallback rather than whatever happens to be first in the list.
  it('prefers a written track over an automatic one', () => {
    const picked = pickTrack([
      { baseUrl: 'a', languageCode: 'en', kind: 'asr' },
      { baseUrl: 'b', languageCode: 'de' },
    ])
    expect(picked?.baseUrl).toBe('b')
  })

  it('prefers English only as a tiebreak', () => {
    const picked = pickTrack([
      { baseUrl: 'a', languageCode: 'de' },
      { baseUrl: 'b', languageCode: 'en' },
    ])
    expect(picked?.baseUrl).toBe('b')
  })

  it('takes an automatic track rather than nothing', () => {
    expect(pickTrack([{ baseUrl: 'a', languageCode: 'en', kind: 'asr' }])?.baseUrl).toBe('a')
  })

  it('returns null when there is nothing to pick', () => {
    expect(pickTrack([])).toBeNull()
  })
})

describe('transcriptFromXml', () => {
  it('joins timed fragments back into prose', () => {
    const xml = `<transcript><text start="0" dur="2">the first bit</text>
      <text start="2" dur="2">and the second bit</text></transcript>`
    expect(transcriptFromXml(xml)).toBe('the first bit and the second bit')
  })

  // Captions are double encoded: the XML carries &amp;#39; for an apostrophe.
  // One decode leaves &#39; visible in the finished note.
  it('decodes the double encoding captions actually use', () => {
    const xml = `<text start="0">it&amp;#39;s here</text>`
    expect(transcriptFromXml(xml)).toBe("it's here")
  })

  it('drops formatting tags inside a caption', () => {
    expect(transcriptFromXml('<text start="0">a <i>word</i> here</text>')).toBe('a word here')
  })

  it('returns empty for a track with no text, rather than throwing', () => {
    expect(transcriptFromXml('<transcript></transcript>')).toBe('')
    expect(transcriptFromXml('')).toBe('')
  })
})
