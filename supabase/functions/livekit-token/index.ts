import { createClient } from 'npm:@supabase/supabase-js@2.117.3'
import { AccessToken } from 'npm:livekit-server-sdk@2.19.1'

Deno.serve(async (req: Request) => {
  const origins = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim())
  const origin = req.headers.get('origin') || ''
  const allowed = origins.includes(origin)
  const headers = {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  }
  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers })
  if (!allowed) return json({ error: 'Origin not allowed' }, 403)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401)
  try {
    // Use caller credentials: the channel query is checked by RLS, never service_role.
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    })
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser(authorization.slice(7))
    if (authError || !user) return json({ error: 'Invalid session' }, 401)
    const { channel_id } = await req.json()
    if (typeof channel_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(channel_id))
      return json({ error: 'Invalid channel' }, 400)
    const { data: channel, error } = await client
      .from('channels')
      .select('id,kind,archived')
      .eq('id', channel_id)
      .single()
    if (error || !channel || channel.kind !== 'voice' || channel.archived)
      return json({ error: 'Channel unavailable' }, 403)
    const { data: profile } = await client
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single()
    const url = Deno.env.get('LIVEKIT_URL'),
      apiKey = Deno.env.get('LIVEKIT_API_KEY'),
      secret = Deno.env.get('LIVEKIT_API_SECRET')
    if (!url?.startsWith('wss://') || !apiKey || !secret)
      return json({ error: 'Voice service is not configured' }, 503)
    const token = new AccessToken(apiKey, secret, {
      identity: user.id,
      name: profile?.display_name || 'Membro',
      ttl: '5m',
    })
    token.addGrant({
      roomJoin: true,
      room: `orbita-${channel.id}`,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    })
    return json({ token: await token.toJwt(), url })
  } catch {
    return json({ error: 'Unable to issue voice token' }, 400)
  }
})
