import { describe, expect, it } from 'vitest'
import { deviceLabel } from './passkeys'

describe('deviceLabel', () => {
  it('names the browser and the device from the user agent', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iPhone')
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome on Mac')
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      ),
    ).toBe('Edge on Windows')
    expect(deviceLabel('Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0')).toBe(
      'Firefox on Android',
    )
  })

  it('falls back rather than inventing a device', () => {
    expect(deviceLabel('curl/8.0')).toBe('Browser')
  })
})
