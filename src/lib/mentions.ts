export function mentionQuery(text: string, cursor: number) {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, cursor))
  return match ? { start: cursor - match[1].length - 1, end: cursor, query: match[1] } : null
}

export function insertMention(text: string, range: { start: number; end: number }, username: string) {
  const value = `@${username} `
  return { text: text.slice(0, range.start) + value + text.slice(range.end), cursor: range.start + value.length }
}

export const normalizeMention = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
