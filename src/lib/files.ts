import { check, db, publicKey, supabaseUrl } from './supabase'
import type { Message, Sound } from './types'

export const MAX_FILE = 25 * 1024 * 1024
export function validateFile(
  file: Pick<File, 'size' | 'name' | 'type'>,
  kind: 'attachment' | 'sound' | 'avatar' = 'attachment',
) {
  const limit = kind === 'sound' ? 10 * 1024 * 1024 : kind === 'avatar' ? 2 * 1024 * 1024 : MAX_FILE
  if (!file.size || file.size > limit)
    throw new Error(`O arquivo deve ter entre 1 byte e ${limit / 1024 / 1024} MB.`)
  if (file.name.length > 255) throw new Error('Nome de arquivo muito longo.')
  if (
    kind === 'sound' &&
    !['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg'].includes(file.type)
  )
    throw new Error('Escolha um áudio MP3, WAV ou OGG.')
  if (kind === 'avatar' && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Escolha uma imagem JPG, PNG ou WebP.')
}
export function bytes(size: number) {
  return size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / 1024 / 1024).toFixed(1)} MB`
}
export const safePreview = (mime: string) =>
  /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm)|audio\/(mpeg|wav|x-wav|ogg))$/.test(mime)

export async function upload(
  bucket: string,
  path: string,
  file: File,
  progress: (n: number) => void,
) {
  const { session } = check(await db().auth.getSession())
  if (!session) throw new Error('Sua sessão expirou. Entre novamente.')
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${supabaseUrl}/storage/v1/object/${bucket}/${path}`)
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
    xhr.setRequestHeader('apikey', publicKey!)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.setRequestHeader('Cache-Control', 'max-age=3600')
    xhr.timeout = 120_000
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error('Falha no upload. Verifique sua conexão e permissões.'))
    xhr.onerror = () => reject(new Error('A conexão foi interrompida durante o envio.'))
    xhr.ontimeout = () => reject(new Error('O envio excedeu dois minutos. Tente um arquivo menor.'))
    xhr.send(file)
  })
}
export async function attachFile(file: File, message: Message, progress: (n: number) => void) {
  validateFile(file)
  const id = crypto.randomUUID(),
    path = `${message.author_id}/${id}`
  check(
    await db()
      .from('attachments')
      .insert({
        id,
        message_id: message.id,
        owner_id: message.author_id,
        path,
        name: file.name,
        size: file.size,
        mime_type: file.type || 'application/octet-stream',
      }),
  )
  try {
    await upload('attachments', path, file, progress)
    check(await db().from('attachments').update({ ready: true }).eq('id', id))
  } catch (e) {
    await db().storage.from('attachments').remove([path])
    await db().from('attachments').delete().eq('id', id)
    throw e
  }
}
export async function addSound(file: File, owner: string, progress: (n: number) => void) {
  validateFile(file, 'sound')
  const id = crypto.randomUUID(),
    path = `${owner}/${id}`
  check(
    await db()
      .from('soundboard_sounds')
      .insert({
        id,
        owner_id: owner,
        path,
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 64),
        size: file.size,
        mime_type: file.type,
      }),
  )
  try {
    await upload('sounds', path, file, progress)
    check(await db().from('soundboard_sounds').update({ ready: true }).eq('id', id))
  } catch (e) {
    await db().storage.from('sounds').remove([path])
    await db().from('soundboard_sounds').delete().eq('id', id)
    throw e
  }
}
export async function deleteSound(sound: Sound) {
  check(await db().storage.from('sounds').remove([sound.path]))
  check(await db().from('soundboard_sounds').delete().eq('id', sound.id))
}
export async function signedUrl(bucket: string, path: string, download?: string) {
  return check(
    await db()
      .storage.from(bucket)
      .createSignedUrl(path, 60, download ? { download } : undefined),
  ).signedUrl
}
