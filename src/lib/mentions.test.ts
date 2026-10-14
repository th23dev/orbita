import { expect, it } from 'vitest'
import { insertMention, mentionQuery, normalizeMention } from './mentions'

it('opens suggestions for @ and filters the text at the cursor', () => {
  expect(mentionQuery('@', 1)).toEqual({ start: 0, end: 1, query: '' })
  expect(mentionQuery('Oi @raf amanhã', 7)).toEqual({ start: 3, end: 7, query: 'raf' })
  expect(mentionQuery('Oi\n@rafa', 8)?.query).toBe('rafa')
})
it('does not treat email addresses or finished mentions as active queries', () => {
  expect(mentionQuery('nome@email', 10)).toBeNull()
  expect(mentionQuery('@rafa ', 6)).toBeNull()
})
it('inserts a selected username preserving the rest of the message', () => {
  expect(insertMention('Oi @ra, tudo bem?', { start: 3, end: 6 }, 'rafael'))
    .toEqual({ text: 'Oi @rafael , tudo bem?', cursor: 11 })
  expect(normalizeMention('João')).toBe('joao')
})
