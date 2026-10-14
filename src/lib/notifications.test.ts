import { expect, it } from 'vitest'
import { notificationTarget, shouldNotify } from './notifications'
import type { Message, Space } from './types'
const message = { id: 'message', author_id: 'alice', channel_id: 'general', conversation_id: null, deleted_at: null } as Message
const space: Space = { id: 'general', kind: 'channel', name: 'geral' }
it('notifies about other chats even when the app is visible', () => {
  expect(shouldNotify(message, 'bob', { ...space, id: 'other' }, true)).toBe(true)
  expect(shouldNotify(message, 'bob', space, true)).toBe(false)
  expect(shouldNotify(message, 'bob', space, false)).toBe(true)
})
it('ignores own messages and deleted messages', () => {
  expect(shouldNotify(message, 'alice', null, false)).toBe(false)
  expect(shouldNotify({ ...message, deleted_at: 'now' }, 'bob', null, false)).toBe(false)
})
it('handles direct conversation aliases and builds the correct target', () => {
  const dm = { ...message, channel_id: null, conversation_id: 'alias' }
  expect(notificationTarget(dm)).toEqual({ kind: 'dm', id: 'alias' })
  expect(shouldNotify(dm, 'bob', { kind: 'dm', id: 'canonical', name: 'Alice', conversationIds: ['alias'] }, true)).toBe(false)
  expect(notificationTarget(message)).toEqual({ kind: 'channel', id: 'general' })
})
