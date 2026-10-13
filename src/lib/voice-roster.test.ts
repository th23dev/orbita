import { expect, it } from 'vitest'
import { reconcileVoiceMembers, voiceMembers } from './voice-roster'
const alice = { userId: 'alice', muted: true, speaking: false, camera: false, screen: false }
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
