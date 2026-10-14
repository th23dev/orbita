let context: AudioContext | null = null
/** Unlock on the join gesture; reuse the context for participant notifications. */
export function unlockCallSounds() {
  try {
    context ??= new AudioContext()
    void context.resume().catch(() => {})
  } catch {
    /* Audio notifications are optional. */
  }
}
export function playCallSound(kind: 'join' | 'leave', volume = 0.35) {
  if (!context || context.state !== 'running') return
  const frequencies = kind === 'join' ? [440, 660] : [660, 392]
  frequencies.forEach((frequency, index) => {
    const start = context!.currentTime + index * 0.11
    const oscillator = context!.createOscillator()
    const gain = context!.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, volume)) * 0.18, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.17)
    oscillator.connect(gain)
    gain.connect(context!.destination)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
    oscillator.start(start)
    oscillator.stop(start + 0.18)
  })
}
