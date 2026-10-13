export type StreamIdentity = { sid: string; kind: 'screen' | 'camera' }
export function featuredStream<T extends StreamIdentity>(
  streams: T[],
  selected: string | null,
): T | null {
  const chosen = streams.find((stream) => stream.sid === selected)
  if (chosen) return chosen
  const screen = streams.find((stream) => stream.kind === 'screen')
  if (screen) return screen
  return streams.length === 1 ? streams[0] : null
}
