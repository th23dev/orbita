import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room } from 'livekit-client'
import { Soundboard } from './soundboard'

vi.mock('livekit-client', () => ({
  Track: { Source: { Unknown: 'unknown' } },
  LocalAudioTrack: class {
    constructor(public mediaStreamTrack: unknown, _constraints: unknown, public isUserProvided: boolean) {}
    stop = vi.fn()
  },
}))

const mediaTrack = { stop: vi.fn() }
class AudioContextStub {
  static current: AudioContextStub
  destination = {}
  source = {
    buffer: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null,
  }
  output = { stream: { getAudioTracks: () => [mediaTrack], getTracks: () => [mediaTrack] } }
  gain = { gain: { value: 1 }, connect: vi.fn() }
  constructor() {
    AudioContextStub.current = this
  }
  createMediaStreamDestination = () => this.output
  createGain = () => this.gain
  createBufferSource = () => this.source
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn().mockResolvedValue(undefined)
  decodeAudioData = vi.fn().mockResolvedValue({ duration: 2 })
}

describe('Soundboard track lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('AudioContext', AudioContextStub)
    vi.clearAllMocks()
  })
  afterEach(() => vi.unstubAllGlobals())
  const create = () => {
    const participant = {
      publishTrack: vi.fn().mockResolvedValue({}),
      unpublishTrack: vi.fn().mockResolvedValue(undefined),
    }
    return {
      participant,
      board: new Soundboard({ localParticipant: participant } as unknown as Room),
    }
  }
  it('publishes the Web Audio destination as a room track and frees it on leave', async () => {
    const { participant, board } = create()
    await board.play(async () => new ArrayBuffer(4), 0.4)
    const context = AudioContextStub.current
    expect(participant.publishTrack).toHaveBeenCalledWith(
      expect.objectContaining({ mediaStreamTrack: mediaTrack, isUserProvided: true }),
      expect.objectContaining({ name: 'orbita-soundboard' }),
    )
    expect(context.gain.connect).toHaveBeenCalledWith(context.output)
    expect(context.source.start).toHaveBeenCalledOnce()
    expect(context.gain.gain.value).toBe(0.4)
    await board.dispose()
    expect(context.source.stop).toHaveBeenCalledOnce()
    expect(participant.unpublishTrack).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
  })
  it('stopping during a slow download prevents delayed playback', async () => {
    const { board } = create()
    let finish!: (data: ArrayBuffer) => void
    const load = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve
        }),
    )
    const playback = board.play(load, 0.5)
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
    board.stop()
    finish(new ArrayBuffer(4))
    await playback
    expect(AudioContextStub.current.source.start).not.toHaveBeenCalled()
    await board.dispose()
  })
  it('the latest selection wins when two sounds load out of order', async () => {
    const { board, participant } = create()
    let finish!: (data: ArrayBuffer) => void
    const slow = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve
        }),
    )
    const first = board.play(slow, 0.2)
    await vi.waitFor(() => expect(slow).toHaveBeenCalledOnce())
    await board.play(async () => new ArrayBuffer(8), 0.7)
    finish(new ArrayBuffer(4))
    await first
    expect(AudioContextStub.current.source.start).toHaveBeenCalledOnce()
    expect(AudioContextStub.current.gain.gain.value).toBe(0.7)
    expect(participant.publishTrack).toHaveBeenCalledOnce()
    await board.dispose()
  })
  it('resumes audio on the click before a slow publication completes', async () => {
    const { board, participant } = create()
    let publish!: () => void
    participant.publishTrack.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          publish = resolve
        }),
    )
    const playback = board.play(async () => new ArrayBuffer(4), 0.5)
    expect(AudioContextStub.current.resume).toHaveBeenCalled()
    await vi.waitFor(() => expect(participant.publishTrack).toHaveBeenCalledOnce())
    expect(AudioContextStub.current.source.start).not.toHaveBeenCalled()
    publish()
    await playback
    expect(AudioContextStub.current.source.start).toHaveBeenCalledOnce()
    await board.dispose()
  })
  it('allows a local preview before joining a room', async () => {
    const board = new Soundboard()
    await board.play(async () => new ArrayBuffer(4), 0.6)
    expect(AudioContextStub.current.source.start).toHaveBeenCalledOnce()
    expect(AudioContextStub.current.gain.connect).toHaveBeenCalledWith(
      AudioContextStub.current.destination,
    )
    await board.dispose()
  })
  it('prepares the room track before a clip is selected and reuses it for playback', async () => {
    const { board, participant } = create()
    await board.prepare()
    expect(participant.publishTrack).toHaveBeenCalledOnce()
    expect(AudioContextStub.current.source.start).not.toHaveBeenCalled()
    const ended = vi.fn()
    await board.play(async () => new ArrayBuffer(4), 0.5, ended)
    expect(participant.publishTrack).toHaveBeenCalledOnce()
    ;(AudioContextStub.current.source.onended as unknown as () => void)()
    expect(ended).toHaveBeenCalledOnce()
    await board.dispose()
  })
  it('resumes again after loading, before starting the decoded sound', async () => {
    const board = new Soundboard()
    await board.play(async () => {
      AudioContextStub.current.resume.mockClear()
      return new ArrayBuffer(4)
    }, 0.5)
    expect(AudioContextStub.current.resume).toHaveBeenCalledOnce()
    expect(AudioContextStub.current.resume.mock.invocationCallOrder[0])
      .toBeLessThan(AudioContextStub.current.source.start.mock.invocationCallOrder[0])
    await board.dispose()
  })
  it('can retry after publication failed instead of caching a rejected promise', async () => {
    const { board, participant } = create()
    participant.publishTrack.mockRejectedValueOnce(new Error('temporary failure'))
    await expect(board.play(async () => new ArrayBuffer(4), 0.5)).rejects.toThrow(
      'temporary failure',
    )
    await board.play(async () => new ArrayBuffer(4), 0.5)
    expect(participant.publishTrack).toHaveBeenCalledTimes(2)
    expect(AudioContextStub.current.source.start).toHaveBeenCalledOnce()
    await board.dispose()
  })
  it('always releases local media if unpublish fails after disconnection', async () => {
    const { board, participant } = create()
    await board.play(async () => new ArrayBuffer(4), 0.5)
    participant.unpublishTrack.mockRejectedValueOnce(new Error('disconnected'))
    await expect(board.dispose()).rejects.toThrow('disconnected')
    expect(mediaTrack.stop).toHaveBeenCalled()
    expect(AudioContextStub.current.close).toHaveBeenCalledOnce()
  })
})
