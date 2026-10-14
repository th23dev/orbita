self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data
  if (!target || !['channel', 'dm'].includes(target.kind) || !/^[a-f0-9-]{36}$/.test(target.id)) return
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const client = clients.find((item) => item.url.startsWith(self.registration.scope))
    if (client) {
      await client.focus()
      client.postMessage({ type: 'orbita-notification-open', ...target })
    } else {
      await self.clients.openWindow(`${self.registration.scope}#/${target.kind}/${target.id}`)
    }
  })())
})
