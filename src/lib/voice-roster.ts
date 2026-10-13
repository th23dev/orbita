export type VoiceState = { muted: boolean; speaking: boolean; camera: boolean; screen: boolean }
export type VoiceMember = VoiceState & { userId: string }
export type VoiceSession = Partial<VoiceState> & { inCall?: boolean; sessionId?: string }

export function voiceMembers(
  state: Record<string, VoiceSession[]>,
  updates: Map<string, VoiceState>,
): VoiceMember[] {
  return Object.entries(state)
    .flatMap(([userId, sessions]) => {
      const connected = sessions
        .filter((session) => session.inCall === true)
        .map((session) => updates.get(session.sessionId || '') || session)
      return connected.length
        ? [
            {
              userId,
              muted: connected.every((session) => session.muted === true),
              speaking: connected.some((session) => session.speaking === true),
              camera: connected.some((session) => session.camera === true),
              screen: connected.some((session) => session.screen === true),
            },
          ]
        : []
    })
    .sort((a, b) => a.userId.localeCompare(b.userId))
}

// Empty snapshots during updates/reconnection do not immediately erase members.
// Repeated snapshots cannot extend the bounded grace period for a real departure.
export function reconcileVoiceMembers(
  previous: VoiceMember[],
  current: VoiceMember[],
  missing: Map<string, number>,
  now: number,
  grace = 1500,
): VoiceMember[] {
  const result = new Map(current.map((member) => [member.userId, member]))
  for (const member of current) missing.delete(member.userId)
  for (const member of previous) {
    if (result.has(member.userId)) continue
    const since = missing.get(member.userId) ?? now
    missing.set(member.userId, since)
    if (now - since < grace) result.set(member.userId, member)
  }
  for (const id of missing.keys()) if (!result.has(id)) missing.delete(id)
  return [...result.values()].sort((a, b) => a.userId.localeCompare(b.userId))
}
