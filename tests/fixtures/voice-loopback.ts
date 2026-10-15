import { ConnectionState, LocalAudioTrack, Track } from 'livekit-client'
import type { Room } from 'livekit-client'
import { VoiceMicrophone } from '../../src/lib/voice-microphone'
import { defaultAudioPreferences } from '../../src/lib/audio-preferences'
import type { NoiseSuppressionMode } from '../../src/lib/voice-gate'

/** Real SDK track + production microphone controller + local WebRTC transport.
 * Only room signaling/capture are replaced; no microphone permission or remote server is needed.
 */
export async function measureVoiceLoopback() {
  const context = new AudioContext({ sampleRate: 48000 })
  const sender = new RTCPeerConnection({ iceServers: [] })
  const receiver = new RTCPeerConnection({ iceServers: [] })
  let track: LocalAudioTrack | undefined
  let voice: AudioBufferSourceNode | undefined
  let noise: AudioBufferSourceNode | undefined
  let monitor: HTMLAudioElement | undefined
  try {
    await context.resume()
    const input = context.createMediaStreamDestination()
    const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    let seed = 42,
      fan = 0
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
      // Broadband fan noise, above the expander threshold: a gate alone fails this test.
      fan = 0.85 * fan + 0.15 * ((seed / 2 ** 32) * 2 - 1)
      data[i] = fan * 0.2
    }
    noise = context.createBufferSource()
    noise.buffer = noiseBuffer
    noise.loop = true
    noise.connect(input)
    noise.start()
    const speech = await context.decodeAudioData(
      await (await fetch('/tests/fixtures/voice-reference.wav')).arrayBuffer(),
    )
    const voiceGain = context.createGain()
    voiceGain.gain.value = 0
    voiceGain.connect(input)
    const restartSpeech = () => {
      voice?.stop()
      voice = context.createBufferSource()
      voice.buffer = speech
      voice.loop = true
      voice.connect(voiceGain)
      voice.start(0, 2)
    }
    const raw = input.stream.getAudioTracks()[0]
    // Generated tracks cannot apply microphone echo/noise constraints. This test
    // measures our worklet, independently of browser-native capture suppression.
    raw.applyConstraints = async () => {}
    track = new LocalAudioTrack(raw, undefined, true, context)
    track.source = Track.Source.Microphone
    let publication: { track: LocalAudioTrack } | undefined
    let processedBeforePublish = false
    let workletReady = false
    let rtpSender: RTCRtpSender | undefined
    const remoteTrack = new Promise<MediaStreamTrack>((resolve) => {
      receiver.ontrack = (event) => resolve(event.track)
    })
    const initial = {
      ...defaultAudioPreferences,
      profile: 'custom' as const,
      noiseSuppression: 'off' as const,
    }
    const room = {
      state: ConnectionState.Connected,
      localParticipant: {
        createTracks: async () => [track!],
        getTrackPublication: () => publication,
        publishTrack: async (local: LocalAudioTrack) => {
          processedBeforePublish =
            Boolean(local.getProcessor()?.processedTrack) && local.mediaStreamTrack !== raw
          publication = { track: local }
          rtpSender = sender.addTrack(local.mediaStreamTrack)
        },
        setMicrophoneEnabled: async (enabled: boolean) => {
          if (enabled) await track!.unmute()
          else await track!.mute()
        },
      },
    } as unknown as Room
    const microphone = new VoiceMicrophone(room, initial, (ready) => {
      workletReady = ready
    })
    await microphone.setEnabled(true)
    const localAnalyser = context.createAnalyser()
    localAnalyser.fftSize = 4096
    context
      .createMediaStreamSource(new MediaStream([track.mediaStreamTrack]))
      .connect(localAnalyser)
    const localRms: number[] = []
    await sender.setLocalDescription(await sender.createOffer())
    // Include gathered candidates in SDP, avoiding external STUN/TURN or candidate races.
    const gather = async (pc: RTCPeerConnection) => {
      for (let i = 0; i < 100 && pc.iceGatheringState !== 'complete'; i++)
        await new Promise((resolve) => setTimeout(resolve, 50))
      if (pc.iceGatheringState !== 'complete') throw new Error('ICE gathering timed out')
    }
    await gather(sender)
    await receiver.setRemoteDescription(sender.localDescription!)
    await receiver.setLocalDescription(await receiver.createAnswer())
    await gather(receiver)
    await sender.setRemoteDescription(receiver.localDescription!)
    const received = await remoteTrack
    const remoteStream = new MediaStream([received])
    const analyser = context.createAnalyser()
    analyser.fftSize = 4096
    context.createMediaStreamSource(remoteStream).connect(analyser)
    monitor = new Audio()
    monitor.srcObject = remoteStream
    monitor.volume = 0
    await monitor.play()
    for (let i = 0; i < 100 && sender.connectionState !== 'connected'; i++)
      await new Promise((resolve) => setTimeout(resolve, 50))
    if (sender.connectionState !== 'connected') throw new Error('WebRTC loopback did not connect')
    const waitAudio = async (seconds: number) => {
      const target = context.currentTime + seconds
      for (let i = 0; i < 200 && context.currentTime < target; i++)
        await new Promise((resolve) => setTimeout(resolve, 25))
      if (context.currentTime < target) throw new Error('Audio clock stopped')
    }
    const samples = new Float32Array(analyser.fftSize)
    const rms = async () => {
      let sum = 0
      for (let i = 0; i < 30; i++) {
        await waitAudio(0.05)
        analyser.getFloatTimeDomainData(samples)
        for (const value of samples) sum += value * value
      }
      return Math.sqrt(sum / (30 * samples.length))
    }
    const measure = async (mode: NoiseSuppressionMode, voice = false) => {
      await microphone.configure({ ...initial, noiseSuppression: mode })
      voiceGain.gain.value = voice ? 1 : 0
      if (voice) restartSpeech()
      await waitAudio(1.5)
      const localSamples = new Float32Array(localAnalyser.fftSize)
      localAnalyser.getFloatTimeDomainData(localSamples)
      localRms.push(
        Math.sqrt(localSamples.reduce((sum, v) => sum + v * v, 0) / localSamples.length),
      )
      return rms()
    }
    const quietOff = await measure('off')
    const quietBalanced = await measure('balanced')
    const quietStrong = await measure('strong')
    const voiceOff = await measure('off', true)
    const voiceBalanced = await measure('balanced', true)
    await microphone.setEnabled(false)
    await waitAudio(0.5)
    const muted = await rms()
    await microphone.setEnabled(true)
    await waitAudio(0.5)
    const unmuted = await rms()
    const stats = await rtpSender!.getStats()
    let bytesSent = 0
    stats.forEach((stat) => {
      if (stat.type === 'outbound-rtp') bytesSent += stat.bytesSent || 0
    })
    return {
      nativeSuppressionTested: false,
      localRms,
      processedBeforePublish,
      workletReady,
      bytesSent,
      quietOff,
      quietBalanced,
      quietStrong,
      voiceOff,
      voiceBalanced,
      muted,
      unmuted,
      balancedReductionDb: 20 * Math.log10(quietOff / Math.max(quietBalanced, 1e-10)),
      strongReductionDb: 20 * Math.log10(quietOff / Math.max(quietStrong, 1e-10)),
      voiceChangeDb: 20 * Math.log10(voiceBalanced / voiceOff),
    }
  } finally {
    monitor?.pause()
    if (monitor) monitor.srcObject = null
    track?.stop()
    noise?.stop()
    voice?.stop()
    sender.close()
    receiver.close()
    await context.close()
  }
}
