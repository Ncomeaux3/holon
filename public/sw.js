// The service worker exists for one reason: a push notification cannot be
// delivered to a page that is closed, and this is the only thing a browser will
// wake up. It caches nothing and intercepts no fetches, so it cannot serve a
// stale page: offline support is a separate decision nobody has taken.

self.addEventListener('push', (event) => {
  // A push with no data is a wake-up from the push service, not a message. Show
  // nothing rather than an empty notification, which some browsers require a
  // notification for and others do not.
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Holon', body: event.data.text(), url: '/' }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Holon', {
      body: payload.body || '',
      icon: '/brand/holon-app-dark-192.png',
      badge: '/brand/holon-app-dark-192.png',
      // One tag, so a second notification replaces the first rather than
      // stacking. The digest is one message a day by design.
      tag: 'holon-digest',
      renotify: true,
      data: { url: payload.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus a tab that is already open rather than opening a fourth one.
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
