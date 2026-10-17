import { AccessToken, TokenVerifier } from 'npm:livekit-server-sdk@2.19.1'
import { publicationGrant } from './publication-grant.ts'

// Sign and verify real JWTs: checking just the grant object misses SDK serialization errors.
for (let mask = 0; mask < 8; mask++) {
  Deno.test(`voice token serializes and preserves media permissions (${mask})`, async () => {
    const permissions = {
      speak: Boolean(mask & 1),
      use_camera: Boolean(mask & 2),
      share_screen: Boolean(mask & 4),
    }
    const secret = 'test-only-secret-with-at-least-32-characters'
    const token = new AccessToken('test-key', secret, { identity: 'test-user', ttl: '5m' })
    token.addGrant({ roomJoin: true, room: 'test-room', canPublishData: false, ...publicationGrant(permissions) })
    const claims = await new TokenVerifier('test-key', secret).verify(await token.toJwt())
    const grant = claims.video!
    if (grant.canPublish !== (mask !== 0)) throw new Error('Incorrect publish permission')
    if (mask === 7) {
      if (grant.canPublishSources !== undefined) throw new Error('Soundboard must remain available for unrestricted members')
    } else {
      const expected = [
        ...(permissions.speak ? ['microphone'] : []),
        ...(permissions.use_camera ? ['camera'] : []),
        ...(permissions.share_screen ? ['screen_share', 'screen_share_audio'] : []),
      ]
      if (JSON.stringify(grant.canPublishSources) !== JSON.stringify(expected))
        throw new Error('Token grants an incorrect set of media sources')
    }
  })
}
