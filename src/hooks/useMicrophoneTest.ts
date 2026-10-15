import { useEffect, useRef, useState } from 'react'
import { Track } from 'livekit-client'
import { VoiceProcessor, voiceCaptureOptions } from '../lib/voice-processing'
import { canSelectAudioOutput } from '../lib/audio-preferences'
import type { AudioPreferences } from '../lib/audio-preferences'

export function useMicrophoneTest(preferences: AudioPreferences) {
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)
  const [enhanced, setEnhanced] = useState(true)
  const sequence = useRef(0)
  const session = useRef<{
    context: AudioContext
    stream?: MediaStream
    processor?: VoiceProcessor
    audio?: HTMLAudioElement
    source?: MediaStreamAudioSourceNode
    frame?: number
  } | null>(null)
  const latest = useRef(preferences)
  latest.current = preferences
  const stop = () => {
    sequence.current++
    const current = session.current
    session.current = null
    if (current) {
      cancelAnimationFrame(current.frame ?? 0)
      current.audio?.pause()
      if (current.audio) current.audio.srcObject = null
      current.source?.disconnect()
      void current.processor?.destroy()
      current.stream?.getTracks().forEach((track) => track.stop())
      void current.context.close().catch(() => {})
    }
    setRunning(false)
    setBusy(false)
    setLevel(0)
    setListening(false)
  }
  useEffect(() => () => stop(), [])

  const start = async () => {
    stop()
    const token = sequence.current
    setError('')
    setBusy(true)
    const p = latest.current
    try {
      const context = new AudioContext()
      const current: NonNullable<typeof session.current> = { context }
      session.current = current
      await context.resume()
      if (token !== sequence.current) return
      const stream = await navigator.mediaDevices.getUserMedia({ audio: voiceCaptureOptions(p) })
      if (token !== sequence.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      current.stream = stream
      const processor = new VoiceProcessor(p, (ready) => {
        if (token === sequence.current) setEnhanced(ready)
      })
      current.processor = processor
      await processor.init({
        kind: Track.Kind.Audio,
        track: stream.getAudioTracks()[0],
        audioContext: context,
      })
      if (token !== sequence.current) return
      const processed = new MediaStream([processor.processedTrack ?? stream.getAudioTracks()[0]])
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      const source = context.createMediaStreamSource(processed)
      current.source = source
      source.connect(analyser)
      const audio = new Audio()
      current.audio = audio
      audio.srcObject = processed
      audio.volume = p.outputVolume
      if (canSelectAudioOutput())
        await audio.setSinkId(p.outputDevice === 'default' ? '' : p.outputDevice)
      if (token !== sequence.current) return
      const samples = new Float32Array(analyser.fftSize)
      const measure = () => {
        if (token !== sequence.current) return
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (const value of samples) sum += value * value
        const db = 20 * Math.log10(Math.sqrt(sum / samples.length) + 1e-8)
        setLevel(Math.max(0, Math.min(1, (db + 60) / 60)))
        current.frame = requestAnimationFrame(measure)
      }
      measure()
      setRunning(true)
    } catch {
      if (token === sequence.current) {
        stop()
        setError(
          'Não foi possível iniciar o teste. Verifique o dispositivo e a permissão do microfone.',
        )
      }
    } finally {
      if (token === sequence.current) setBusy(false)
    }
  }
  const toggleListening = async () => {
    const audio = session.current?.audio
    if (!audio) return
    if (listening) {
      audio.pause()
      setListening(false)
    } else {
      try {
        await audio.play()
        setListening(true)
      } catch {
        setError('Não foi possível reproduzir o teste no dispositivo de saída.')
      }
    }
  }
  useEffect(() => {
    const current = session.current
    if (!current?.stream) return
    const {
      deviceId: _device,
      channelCount: _channels,
      ...constraints
    } = voiceCaptureOptions(preferences)
    current.processor?.configure(preferences)
    if (current.audio) {
      current.audio.volume = preferences.outputVolume
      if (canSelectAudioOutput())
        void current.audio
          .setSinkId(preferences.outputDevice === 'default' ? '' : preferences.outputDevice)
          .catch(() => setError('Não foi possível usar esta saída no teste.'))
    }
    void current.stream
      .getAudioTracks()[0]
      .applyConstraints(constraints)
      .catch(() => setError('O navegador não conseguiu aplicar todos os ajustes ao teste.'))
  }, [preferences])
  useEffect(() => {
    stop()
  }, [preferences.inputDevice])
  return { running, busy, level, error, listening, enhanced, start, stop, toggleListening }
}
