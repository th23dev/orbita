import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
export const configured = Boolean(
  supabaseUrl?.startsWith('https://') &&
  publicKey?.startsWith('sb_publishable_') &&
  !supabaseUrl.includes('YOUR_PROJECT') &&
  !publicKey.includes('REPLACE'),
)
export const supabase = configured
  ? createClient(supabaseUrl!, publicKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null
export function db() {
  if (!supabase) throw new Error('Configure a conexão com o Supabase para continuar.')
  return supabase
}
export function check<T extends { data?: unknown; error: { message: string } | null }>(
  result: T,
): NonNullable<T['data']> {
  if (result.error) throw new Error(result.error.message)
  return result.data as NonNullable<T['data']>
}
export const redirectUrl = () => new URL(import.meta.env.BASE_URL, window.location.href).href
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.'
}
