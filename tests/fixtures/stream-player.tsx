import React from 'react'
import { createRoot } from 'react-dom/client'
import { LocalVideoTrack } from 'livekit-client'
import { StreamPlayer } from '../../src/components/StreamPlayer'

export function mountStreamPlayer() {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const context = canvas.getContext('2d')!
  context.fillStyle = '#153f2c'
  context.fillRect(0, 0, 1280, 720)
  context.fillStyle = '#b7ef78'
  context.font = '64px sans-serif'
  context.fillText('Transmissão de teste', 100, 360)
  const stream = canvas.captureStream(5)
  const track = new LocalVideoTrack(stream.getVideoTracks()[0])
  const host = document.createElement('div')
  host.style.cssText =
    'position:fixed;inset:0;background:#161719;padding:16px;z-index:10000;display:flex;flex-direction:column'
  document.body.append(host)
  const root = createRoot(host)
  root.render(
    <StreamPlayer
      track={track}
      name="Teste"
      report={(message) => {
        throw new Error(message)
      }}
    />,
  )
  Object.assign(window, {
    unmountStreamPlayer: () => {
      root.unmount()
      host.remove()
      track.stop()
    },
  })
}
