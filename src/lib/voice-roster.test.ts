import { expect, it } from 'vitest'
import { reconcileVoiceMembers, voiceMembers } from './voice-roster'
const alice = { userId: 'alice', muted: true, speaking: false, camera: false, screen: false }
it('removes confirmed departures immediately without delaying remaining participants', () => {
  const bob = { ...alice, userId: 'bob' }
  expect(reconcileVoiceMembers([alice, bob], [bob], new Map(), 0, 0)).toEqual([bob])
})
it('hides a departed local session before server acknowledgment but preserves another tab', () => {
  const local = { inCall: true, sessionId: 'local', muted: true }
  const remote = { inCall: true, sessionId: 'other-tab', muted: true }
  expect(voiceMembers({ alice: [local] }, new Map(), 'local')).toEqual([])
  expect(voiceMembers({ alice: [local, remote] }, new Map(), 'local')).toEqual([alice])
})
it('keeps members across brief empty snapshots and removes real departures after the grace period', () => {
  const missing = new Map<string, number>()
  expect(reconcileVoiceMembers([alice], [], missing, 0)).toEqual([alice])
  expect(reconcileVoiceMembers([alice], [], missing, 900)).toEqual([alice])
  expect(reconcileVoiceMembers([alice], [], missing, 1500)).toEqual([])
})
it('cancels pending removal when presence returns and applies media updates without removing membership', () => {
  const missing = new Map<string, number>()
  reconcileVoiceMembers([alice], [], missing, 0)
  const speaking = { ...alice, muted: false, speaking: true }
  expect(reconcileVoiceMembers([alice], [speaking], missing, 600)).toEqual([speaking])
  expect(missing.size).toBe(0)
  expect(reconcileVoiceMembers([speaking], [], missing, 1600)).toEqual([speaking])
})
it('merges multiple sessions for one member and ignores observers outside the call', () => {
  const state = {
    alice: [
      { inCall: true, sessionId: 'one', muted: true },
      { inCall: true, sessionId: 'two', muted: true },
    ],
    bob: [{ inCall: false }],
  }
  expect(
    voiceMembers(state, new Map([['two', { ...alice, muted: false, speaking: true }]])),
  ).toEqual([{ ...alice, muted: false, speaking: true }])
  expect(voiceMembers({ alice: [state.alice[1]] }, new Map())).toEqual([alice])
})
