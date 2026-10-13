import { useEffect, useState } from 'react'
import { signedUrl } from '../lib/files'
import type { Server } from '../lib/types'

export function ServerLogo({ server }: { server: Server }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    setUrl('')
    if (server.icon_path)
      void signedUrl('server-icons', server.icon_path)
        .then((value) => {
          if (active) setUrl(value)
        })
        .catch(() => {})
    return () => {
      active = false
    }
  }, [server.icon_path])
  return url ? (
    <img className="server-logo-image" src={url} alt="" onError={() => setUrl('')} />
  ) : (
    <span>{server.name.slice(0, 2).toUpperCase()}</span>
  )
}
