import React from 'react'
import { createRoot } from 'react-dom/client'
import { Settings } from '../../src/components/Settings'

export function mountVideoSettings() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  root.render(<Settings
    me={{ id: '11111111-1111-4111-8111-111111111111', display_name: 'Rafa', username: 'rafa', bio: '', avatar_path: null, status: 'online' }}
    settings={{ user_id: '11111111-1111-4111-8111-111111111111', theme: 'dark', notifications: false, soundboard_volume: 1 }}
    close={() => { root.unmount(); host.remove() }}
    refresh={async () => {}}
    report={message => { throw new Error(message) }}
  />)
}
