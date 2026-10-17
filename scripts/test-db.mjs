import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

// Real PostgreSQL engine in WASM. Only the Supabase-owned schemas are bootstrapped.
const db = new PGlite()
await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema storage; create schema realtime;
  create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
  grant usage on schema auth,storage,realtime to authenticated,anon;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text);
  alter table storage.objects enable row level security;
  grant select,insert,update,delete on storage.objects to authenticated;
  create table realtime.messages(id bigint,extension text);
  alter table realtime.messages enable row level security;
  grant select,insert on realtime.messages to authenticated;
  create publication supabase_realtime;
`)
for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort())
  await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'))
let passed = 0
const test = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`PASS ${name}`)
  } catch (e) {
    console.error(`FAIL ${name}: ${e.message}`)
    await db.close()
    process.exit(1)
  }
}
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
]
for (const id of ids)
  await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [
    id,
    { display_name: id === ids[0] ? 'Alice' : id === ids[1] ? 'Bob' : 'Eve' },
  ])
async function as(user, sql, params = []) {
  await db.exec('begin; set local role authenticated;')
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user])
    const result = await db.query(sql, params)
    await db.exec('commit')
    return result.rows
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}
const denied = (user, sql, params = []) => assert.rejects(() => as(user, sql, params))
let server, channel, privateChannel, invite, role, message, dm, attachment
await test('Auth trigger creates profiles and individual settings', async () => {
  assert.equal((await db.query('select * from public.profiles')).rows.length, 3)
  assert.equal((await as(ids[0], 'select * from user_settings')).length, 1)
})
await test('Server creation atomically creates membership and default channels', async () => {
  server = (
    await as(ids[0], "insert into servers(owner_id,name) values($1,'Test') returning *", [ids[0]])
  )[0]
  const channels = await as(ids[0], 'select * from channels')
  assert.equal(channels.length, 2)
  channel = channels.find((c) => c.kind === 'text')
  assert.equal((await as(ids[0], 'select * from server_members')).length, 1)
})
await test('Outsiders cannot read servers, channels or members', async () => {
  for (const table of ['servers', 'channels', 'server_members'])
    assert.equal((await as(ids[2], `select * from ${table}`)).length, 0)
})
await test('Cannot forge membership or change server ownership', async () => {
  await denied(ids[2], 'insert into server_members(server_id,user_id) values($1,$2)', [
    server.id,
    ids[2],
  ])
  await denied(ids[0], 'update servers set owner_id=$1 where id=$2', [ids[2], server.id])
})
await test('Invitation redemption creates membership and counts exactly once', async () => {
  invite = (
    await as(
      ids[0],
      'insert into invitations(server_id,created_by,max_uses) values($1,$2,1) returning *',
      [server.id, ids[0]],
    )
  )[0]
  await as(ids[1], 'select public.join_server($1)', [invite.code])
  assert.equal((await as(ids[1], 'select * from servers')).length, 1)
  assert.equal((await as(ids[0], 'select uses from invitations'))[0].uses, 1)
  await denied(ids[2], 'select public.join_server($1)', [invite.code])
})
await test('Invites are visible only to server owner', async () =>
  assert.equal((await as(ids[1], 'select * from invitations')).length, 0))
await test('Member can send text; outsider cannot send or read', async () => {
  message = (
    await as(
      ids[1],
      "insert into messages(author_id,channel_id,content) values($1,$2,'hello persistent world') returning *",
      [ids[1], channel.id],
    )
  )[0]
  assert.equal((await as(ids[0], 'select * from messages')).length, 1)
  assert.equal((await as(ids[2], 'select * from messages')).length, 0)
  await denied(
    ids[2],
    "insert into messages(author_id,channel_id,content) values($1,$2,'intrusion')",
    [ids[2], channel.id],
  )
})
await test('Authorship and message scope are immutable', async () => {
  await denied(ids[1], 'update messages set author_id=$1 where id=$2', [ids[0], message.id])
  await denied(ids[1], 'update messages set channel_id=null where id=$1', [message.id])
  assert.equal(
    (await as(ids[0], "update messages set content='forged' where id=$1 returning *", [message.id]))
      .length,
    0,
  )
})
await test('Only owner manages private channels', async () => {
  await denied(ids[1], "insert into channels(server_id,name,kind) values($1,'bad','text')", [
    server.id,
  ])
  privateChannel = (
    await as(
      ids[0],
      "insert into channels(server_id,name,kind,is_private) values($1,'private','text',true) returning *",
      [server.id],
    )
  )[0]
  assert.equal(
    (await as(ids[1], 'select * from channels where id=$1', [privateChannel.id])).length,
    0,
  )
})
await test('Owner can grant and revoke individual channel access; members cannot self-grant', async () => {
  const sql =
    'insert into channel_member_permissions(server_id,channel_id,user_id) values($1,$2,$3)'
  await denied(ids[1], sql, [server.id, privateChannel.id, ids[1]])
  await denied(ids[0], sql, [server.id, privateChannel.id, ids[2]])
  await as(ids[0], sql, [server.id, privateChannel.id, ids[1]])
  assert.equal(
    (await as(ids[1], 'select * from channels where id=$1', [privateChannel.id])).length,
    1,
  )
  await as(ids[1], "insert into messages(author_id,channel_id,content) values($1,$2,'allowed')", [
    ids[1],
    privateChannel.id,
  ])
  assert.equal((await as(ids[1], 'delete from channel_member_permissions returning *')).length, 0)
  await as(ids[0], 'delete from channel_member_permissions where channel_id=$1', [
    privateChannel.id,
  ])
  assert.equal(
    (await as(ids[1], 'select * from channels where id=$1', [privateChannel.id])).length,
    0,
  )
  await denied(
    ids[1],
    "insert into messages(author_id,channel_id,content) values($1,$2,'denied')",
    [ids[1], privateChannel.id],
  )
  const other = (
    await as(ids[0], "insert into servers(owner_id,name) values($1,'Other') returning id", [ids[0]])
  )[0]
  await denied(ids[0], sql, [other.id, privateChannel.id, ids[0]])
})
await test('Server logos are owner-managed and readable only by members', async () => {
  const path = `${server.id}/${crypto.randomUUID()}`
  await denied(ids[1], "insert into storage.objects(bucket_id,name) values('server-icons',$1)", [
    path,
  ])
  await as(ids[0], "insert into storage.objects(bucket_id,name) values('server-icons',$1)", [path])
  await as(ids[0], 'update servers set icon_path=$1 where id=$2', [path, server.id])
  assert.equal(
    (await as(ids[1], "select * from storage.objects where bucket_id='server-icons'")).length,
    1,
  )
  assert.equal(
    (await as(ids[2], "select * from storage.objects where bucket_id='server-icons'")).length,
    0,
  )
  assert.equal(
    (await as(ids[1], 'update servers set icon_path=null where id=$1 returning *', [server.id]))
      .length,
    0,
  )
  await denied(ids[0], 'update servers set icon_path=$1 where id=$2', [
    `${ids[2]}/foreign`,
    server.id,
  ])
  assert.equal(
    (await as(ids[1], "delete from storage.objects where bucket_id='server-icons' returning *"))
      .length,
    0,
  )
  await as(ids[0], 'update servers set icon_path=null where id=$1', [server.id])
  await as(ids[0], "delete from storage.objects where bucket_id='server-icons'")
})
await test('Roles grant private access only to assigned members', async () => {
  role = (
    await as(ids[0], "insert into roles(server_id,name) values($1,'Design') returning *", [
      server.id,
    ])
  )[0]
  await as(
    ids[0],
    'insert into channel_permissions(server_id,channel_id,role_id) values($1,$2,$3)',
    [server.id, privateChannel.id, role.id],
  )
  await denied(ids[1], 'insert into member_roles(server_id,user_id,role_id) values($1,$2,$3)', [
    server.id,
    ids[1],
    role.id,
  ])
  await as(ids[0], 'insert into member_roles(server_id,user_id,role_id) values($1,$2,$3)', [
    server.id,
    ids[1],
    role.id,
  ])
  assert.equal(
    (await as(ids[1], 'select * from channels where id=$1', [privateChannel.id])).length,
    1,
  )
})
await test('Cross-channel replies are rejected', async () =>
  await denied(
    ids[1],
    "insert into messages(author_id,channel_id,content,reply_to) values($1,$2,'bad',$3)",
    [ids[1], privateChannel.id, message.id],
  ))
await test('Reaction scope is derived by the database and cannot be spoofed', async () => {
  await as(ids[0], "insert into message_reactions(message_id,user_id,emoji) values($1,$2,'👍')", [
    message.id,
    ids[0],
  ])
  assert.equal((await as(ids[1], 'select * from message_reactions'))[0].channel_id, channel.id)
  await denied(
    ids[2],
    "insert into message_reactions(message_id,user_id,emoji) values($1,$2,'👍')",
    [message.id, ids[2]],
  )
})
await test('Attachments enforce ownership, size and storage path', async () => {
  attachment = crypto.randomUUID()
  await denied(
    ids[0],
    "insert into attachments(id,message_id,owner_id,path,name,mime_type,size) values($1,$2,$3,$4,'x','text/plain',10)",
    [attachment, message.id, ids[0], `${ids[0]}/${attachment}`],
  )
  await as(
    ids[1],
    "insert into attachments(id,message_id,owner_id,path,name,mime_type,size) values($1,$2,$3,$4,'x.txt','text/plain',10)",
    [attachment, message.id, ids[1], `${ids[1]}/${attachment}`],
  )
  await denied(
    ids[1],
    "insert into attachments(message_id,owner_id,path,name,mime_type,size) values($1,$2,'bad','x','text/plain',26214401)",
    [message.id, ids[1]],
  )
})
await test('Storage denies outsiders and exposes completed uploads to members', async () => {
  await as(ids[1], "insert into storage.objects(bucket_id,name) values('attachments',$1)", [
    `${ids[1]}/${attachment}`,
  ])
  assert.equal(
    (await as(ids[0], "select * from storage.objects where bucket_id='attachments'")).length,
    0,
  )
  await as(ids[1], 'update attachments set ready=true where id=$1', [attachment])
  assert.equal(
    (await as(ids[0], "select * from storage.objects where bucket_id='attachments'")).length,
    1,
  )
  assert.equal(
    (await as(ids[2], "select * from storage.objects where bucket_id='attachments'")).length,
    0,
  )
  await denied(ids[2], "insert into storage.objects(bucket_id,name) values('attachments',$1)", [
    `${ids[1]}/${attachment}`,
  ])
})
await test('Friendship cannot be self-accepted by requester', async () => {
  const f = (
    await as(
      ids[0],
      'insert into friendships(requester_id,addressee_id) values($1,$2) returning *',
      [ids[0], ids[1]],
    )
  )[0]
  assert.equal(
    (await as(ids[0], "update friendships set status='accepted' where id=$1 returning *", [f.id]))
      .length,
    0,
  )
  await as(ids[1], "update friendships set status='accepted' where id=$1", [f.id])
})
await test('DM creation admits confirmed friends only', async () => {
  dm = (await as(ids[0], "select public.create_dm('Friends',$1) as id", [[ids[1]]]))[0].id
  await denied(ids[0], "select public.create_dm('Strangers',$1)", [[ids[2]]])
  assert.equal((await as(ids[2], 'select * from direct_conversations')).length, 0)
  assert.equal((await as(ids[1], 'select * from direct_conversations')).length, 1)
})
await test('DM history is isolated from server membership', async () => {
  await as(
    ids[0],
    "insert into messages(author_id,conversation_id,content) values($1,$2,'private')",
    [ids[0], dm],
  )
  assert.equal(
    (await as(ids[2], 'select * from messages where conversation_id=$1', [dm])).length,
    0,
  )
  await denied(
    ids[2],
    'insert into direct_conversation_members(conversation_id,user_id) values($1,$2)',
    [dm, ids[2]],
  )
})
await test('Private realtime topic authorization respects channel roles', async () => {
  assert.equal(
    (
      await as(ids[1], 'select private.can_topic($1) as allowed', [`channel:${privateChannel.id}`])
    )[0].allowed,
    true,
  )
  assert.equal(
    (await as(ids[2], 'select private.can_topic($1) as allowed', [`channel:${channel.id}`]))[0]
      .allowed,
    false,
  )
  assert.equal(
    (await as(ids[2], "select private.can_topic('channel:invalid') as allowed"))[0].allowed,
    false,
  )
})
await test('Revoking a role immediately prevents future private reads', async () => {
  await as(ids[0], 'delete from member_roles where role_id=$1', [role.id])
  assert.equal(
    (await as(ids[1], 'select * from channels where id=$1', [privateChannel.id])).length,
    0,
  )
})
await test('Voice rosters inherit private-channel authorization, including revoked access', async () => {
  const topic = `channel:${privateChannel.id}:voice-roster`
  assert.equal(
    (await as(ids[0], 'select private.can_topic($1) as allowed', [topic]))[0].allowed,
    true,
  )
  assert.equal(
    (await as(ids[1], 'select private.can_topic($1) as allowed', [topic]))[0].allowed,
    false,
  )
  assert.equal(
    (await as(ids[2], 'select private.can_topic($1) as allowed', [topic]))[0].allowed,
    false,
  )
})
await test('Deleting messages clears content and prevents attachment access', async () => {
  await as(ids[1], 'update messages set deleted_at=now() where id=$1', [message.id])
  assert.equal(
    (await as(ids[0], 'select content from messages where id=$1', [message.id]))[0].content,
    '',
  )
  assert.equal((await as(ids[0], 'select * from attachments')).length, 0)
  assert.equal(
    (await as(ids[0], "select * from storage.objects where bucket_id='attachments'")).length,
    0,
  )
  await denied(ids[1], "update messages set content='restore' where id=$1", [message.id])
})
await test('Sound libraries are private and validate media types', async () => {
  const sound = crypto.randomUUID()
  await as(
    ids[0],
    "insert into soundboard_sounds(id,owner_id,name,path,mime_type,size) values($1,$2,'hello',$3,'audio/ogg',100)",
    [sound, ids[0], `${ids[0]}/${sound}`],
  )
  assert.equal((await as(ids[1], 'select * from soundboard_sounds')).length, 0)
  await denied(
    ids[0],
    "insert into soundboard_sounds(owner_id,name,path,mime_type,size) values($1,'bad','bad','text/html',100)",
    [ids[0]],
  )
})
await test('No one can add users without acceptance, including the owner', async () => {
  const target = (
    await as(
      ids[0],
      "insert into servers(owner_id,name) values($1,'Direct membership') returning id",
      [ids[0]],
    )
  )[0]
  const insert = 'insert into server_members(server_id,user_id) values($1,$2)'
  await denied(ids[1], insert, [target.id, ids[1]])
  await denied(ids[1], insert, [target.id, ids[2]])
  await denied(ids[0], insert, [target.id, ids[1]])
  const invitation = (
    await as(ids[0], 'select public.invite_member($1,$2) as id', [target.id, ids[1]])
  )[0].id
  assert.equal((await as(ids[1], 'select * from servers where id=$1', [target.id])).length, 0)
  await denied(ids[2], 'select public.respond_invite($1,true)', [invitation])
  await as(ids[1], 'select public.respond_invite($1,true)', [invitation])
  assert.equal((await as(ids[1], 'select * from servers where id=$1', [target.id])).length, 1)
  await denied(ids[1], insert, [target.id, ids[2]])
  const otherInvite = (
    await as(ids[0], 'select public.invite_member($1,$2) as id', [target.id, ids[2]])
  )[0].id
  await as(ids[2], 'select public.respond_invite($1,true)', [otherInvite])
  assert.equal(
    (await as(ids[2], 'select * from channels where server_id=$1', [target.id])).length,
    2,
  )
  await denied(ids[0], insert, [target.id, crypto.randomUUID()])
  await denied(
    ids[0],
    'insert into server_members(server_id,user_id,joined_at) values($1,$2,now())',
    [target.id, ids[2]],
  )
})
await test('One-to-one conversations reuse the same id from both users', async () => {
  const first = (await as(ids[0], "select public.create_dm('Bob',$1) as id", [[ids[1]]]))[0].id
  const again = (await as(ids[0], "select public.create_dm('Bob again',$1) as id", [[ids[1]]]))[0]
    .id
  const reverse = (await as(ids[1], "select public.create_dm('Alice',$1) as id", [[ids[0]]]))[0].id
  assert.equal(first, dm)
  assert.equal(again, dm)
  assert.equal(reverse, dm)
})
let consentServer, consentChannel
await test('Creation invites friends atomically and never enrolls them', async () => {
  consentServer = (
    await as(ids[0], "select public.create_community('Consent','A community',$1) as id", [[ids[1]]])
  )[0].id
  assert.equal((await as(ids[1], 'select * from servers where id=$1', [consentServer])).length, 0)
  const inv = (
    await as(ids[1], 'select * from community_invites where server_id=$1', [consentServer])
  )[0]
  assert.ok(inv)
  await as(ids[1], 'select public.respond_invite($1,false)', [inv.id])
  assert.equal((await as(ids[1], 'select * from servers where id=$1', [consentServer])).length, 0)
  await denied(ids[0], "select public.create_community('Invalid','',$1)", [[ids[2]]])
  assert.equal((await as(ids[0], "select * from servers where name='Invalid'")).length, 0)
})
await test('Private channel invitation grants access only after acceptance', async () => {
  consentChannel = (
    await as(ids[0], "select public.create_community('Private','Topic',$1,$2,'text',true) as id", [
      [ids[1]],
      consentServer,
    ])
  )[0].id
  const inv = (
    await as(ids[1], 'select * from community_invites where channel_id=$1', [consentChannel])
  )[0]
  assert.equal((await as(ids[1], 'select * from channels where id=$1', [consentChannel])).length, 0)
  await denied(ids[2], 'select public.respond_invite($1,true)', [inv.id])
  await as(ids[1], 'select public.respond_invite($1,true)', [inv.id])
  assert.equal((await as(ids[1], 'select * from channels where id=$1', [consentChannel])).length, 1)
  assert.equal(
    (await as(ids[1], 'select * from public.channel_people($1)', [consentChannel])).length,
    2,
  )
  await denied(ids[2], 'select * from public.channel_people($1)', [consentChannel])
})
await test('Channel moderators can rename but cannot promote themselves to administrator', async () => {
  await denied(ids[1], "select public.manage_membership($1,$2,'promote')", [consentServer, ids[1]])
  await as(ids[0], "select public.manage_membership($1,$2,'promote',$3)", [
    consentServer,
    ids[1],
    consentChannel,
  ])
  const updated = await as(
    ids[1],
    "update channels set name='Renamed',topic='New topic' where id=$1 returning id",
    [consentChannel],
  )
  assert.equal(updated.length, 1)
  await denied(ids[1], "select public.manage_membership($1,$2,'promote',$3)", [
    consentServer,
    ids[1],
    consentChannel,
  ])
  await denied(ids[1], "select public.manage_membership($1,$2,'remove',$3)", [
    consentServer,
    ids[0],
    consentChannel,
  ])
})
await test('Leaving revokes access even when legacy roles or direct grants allow it', async () => {
  await as(
    ids[0],
    'insert into channel_member_permissions(server_id,channel_id,user_id) values($1,$2,$3)',
    [consentServer, consentChannel, ids[1]],
  )
  await as(ids[1], "select public.manage_membership($1,$2,'leave',$3)", [
    consentServer,
    ids[1],
    consentChannel,
  ])
  assert.equal((await as(ids[1], 'select * from channels where id=$1', [consentChannel])).length, 0)
  await denied(ids[1], "select public.manage_membership($1,$2,'promote',$3)", [
    consentServer,
    ids[1],
    consentChannel,
  ])
  const inv = (
    await as(ids[0], 'select public.invite_member($1,$2,$3) as id', [
      consentServer,
      ids[1],
      consentChannel,
    ])
  )[0].id
  await as(ids[1], 'select public.respond_invite($1,true)', [inv])
  assert.equal((await as(ids[1], 'select * from channels where id=$1', [consentChannel])).length, 1)
})
await test('Only the owner promotes administrators; members can leave the server', async () => {
  await as(ids[0], "select public.manage_membership($1,$2,'promote')", [consentServer, ids[1]])
  assert.equal(
    (
      await as(
        ids[1],
        "insert into channels(server_id,name,kind) values($1,'Admin channel','text') returning id",
        [consentServer],
      )
    ).length,
    1,
  )
  await denied(ids[1], "select public.manage_membership($1,$2,'remove')", [consentServer, ids[0]])
  await as(ids[1], "select public.manage_membership($1,$2,'leave')", [consentServer, ids[1]])
  assert.equal((await as(ids[1], 'select * from servers where id=$1', [consentServer])).length, 0)
  await denied(ids[0], "select public.manage_membership($1,$2,'leave')", [consentServer, ids[0]])
})
await test('Channel deletion checks scope and cascades history without deleting other channels', async () => {
  const s = (await as(ids[0], "insert into servers(owner_id,name) values($1,'Deletion test') returning id", [ids[0]]))[0].id
  await db.query('insert into public.server_members(server_id,user_id) values($1,$2)', [s, ids[1]])
  const channels = await as(ids[0], 'select id,kind from channels where server_id=$1 order by kind', [s])
  const target = channels.find((c) => c.kind === 'text').id
  const other = channels.find((c) => c.kind === 'voice').id
  await as(ids[0], "insert into messages(author_id,channel_id,content) values($1,$2,'To remove')", [ids[0], target])
  assert.equal((await as(ids[2], 'delete from channels where id=$1 returning id', [target])).length, 0)
  assert.equal((await as(ids[1], 'delete from channels where id=$1 returning id', [target])).length, 0)
  await db.query("insert into public.channel_memberships(server_id,channel_id,user_id,status,role) values($1,$2,$3,'accepted','moderator')", [s, target, ids[1]])
  assert.equal((await as(ids[1], 'delete from channels where id=$1 returning id', [other])).length, 0)
  assert.equal((await as(ids[1], 'delete from channels where id=$1 returning id', [target])).length, 1)
  assert.equal((await db.query('select id from messages where channel_id=$1', [target])).rows.length, 0)
  assert.equal((await db.query('select user_id from channel_memberships where channel_id=$1', [target])).rows.length, 0)
  assert.equal((await as(ids[0], 'select id from channels where id=$1', [other])).length, 1)
  assert.equal((await as(ids[0], 'delete from channels where id=$1 returning id', [other])).length, 1)
})
await test('Only the server owner can delete it; contents cascade and other communities survive', async () => {
  const s = (await as(ids[0], "insert into servers(owner_id,name) values($1,'Server deletion test') returning id", [ids[0]]))[0].id
  const c = (await as(ids[0], "select id from channels where server_id=$1 and kind='text'", [s]))[0].id
  const m = (await as(ids[0], "insert into messages(author_id,channel_id,content) values($1,$2,'Remove with server') returning id", [ids[0], c]))[0].id
  await as(ids[0], "insert into roles(server_id,name) values($1,'Test role')", [s])
  await db.query("insert into public.server_members(server_id,user_id) values($1,$2)", [s, ids[1]])
  await as(ids[0], 'select public.invite_member($1,$2)', [s, ids[2]])
  assert.equal((await as(ids[2], 'delete from servers where id=$1 returning id', [s])).length, 0)
  assert.equal((await as(ids[1], 'delete from servers where id=$1 returning id', [s])).length, 0)
  await db.query("update public.server_members set access_role='admin' where server_id=$1 and user_id=$2", [s, ids[1]])
  assert.equal((await as(ids[1], 'delete from servers where id=$1 returning id', [s])).length, 0)
  assert.equal((await as(ids[0], 'delete from servers where id=$1 returning id', [s])).length, 1)
  for (const table of ['channels', 'server_members', 'roles', 'community_invites'])
    assert.equal((await db.query(`select * from public.${table} where server_id=$1`, [s])).rows.length, 0)
  assert.equal((await db.query('select id from messages where id=$1', [m])).rows.length, 0)
  assert.equal((await db.query('select id from servers where id=$1', [server.id])).rows.length, 1)
  assert.equal((await db.query('select id from direct_conversations where id=$1', [dm])).rows.length, 1)
  assert.equal((await db.query('select id from profiles')).rows.length, 3)
})
await test('Role permissions enforce chat, defaults, channel management and ban re-entry', async () => {
  const s = (await as(ids[0], "insert into servers(owner_id,name) values($1,'Permissions') returning id", [ids[0]]))[0].id
  const c = (await as(ids[0], "select id from channels where server_id=$1 and kind='text'", [s]))[0].id
  const r = (await as(ids[0], "insert into roles(server_id,name,permissions) values($1,'Leitura',$2) returning id", [s, { read_chat: true }]))[0].id
  await as(ids[0], 'select set_default_role($1,$2)', [s,r])
  await denied(ids[2], 'select set_default_role($1,$2)', [s,r])
  await denied(ids[0], 'select set_default_role($1,$2)', [s,role.id])
  const inv = (await as(ids[0], 'insert into invitations(server_id,created_by) values($1,$2) returning code', [s,ids[0]]))[0].code
  await as(ids[1], 'select join_server($1)', [inv])
  assert.equal((await as(ids[0], 'select * from member_roles where server_id=$1 and user_id=$2', [s,ids[1]]))[0].role_id,r)
  const perms = () => as(ids[1], 'select server_permissions($1) as p', [s]).then(rows => rows[0].p)
  assert.equal((await perms()).read_chat,true)
  assert.equal((await perms()).send_messages,false)
  assert.equal((await perms()).share_screen,false)
  const msg = (await as(ids[0], "insert into messages(channel_id,author_id,content) values($1,$2,'Visible') returning id", [c,ids[0]]))[0].id
  assert.equal((await as(ids[1], 'select id from messages where id=$1', [msg])).length,1)
  await denied(ids[1], "insert into messages(channel_id,author_id,content) values($1,$2,'Forbidden')", [c,ids[1]])
  await denied(ids[1], "insert into message_reactions(message_id,user_id,emoji) values($1,$2,'👍')", [msg,ids[1]])
  assert.equal((await as(ids[1], "update channels set name='forbidden' where id=$1 returning id", [c])).length,0)
  assert.equal((await as(ids[1], 'update roles set permissions=$1 where id=$2 returning id', [{ ban_members:true },r])).length,0)
  await denied(ids[0], 'update roles set permissions=$1 where id=$2', [{ read_chat:'yes' },r])
  await as(ids[0], 'update roles set permissions=$1 where id=$2', [{},r])
  assert.equal((await as(ids[1], 'select id from messages where id=$1', [msg])).length,0)
  const extra = (await as(ids[0], "insert into roles(server_id,name,permissions) values($1,'Moderador',$2) returning id", [s,{ read_chat:true,send_messages:true,manage_channels:true,ban_members:true }]))[0].id
  await as(ids[0], 'insert into member_roles(server_id,user_id,role_id) values($1,$2,$3)', [s,ids[1],extra])
  assert.equal((await perms()).send_messages,true)
  assert.equal((await perms()).share_screen,false)
  await as(ids[1], "insert into messages(channel_id,author_id,content) values($1,$2,'Allowed')", [c,ids[1]])
  assert.equal((await as(ids[1], "update channels set name='allowed' where id=$1 returning id", [c])).length,1)
  const hidden = (await as(ids[0], "insert into channels(server_id,name,kind,is_private) values($1,'hidden','text',true) returning id", [s]))[0].id
  assert.equal((await as(ids[1], "update channels set name='forbidden' where id=$1 returning id", [hidden])).length,0)
  await denied(ids[1], 'select invite_member($1,$2,$3)', [s,ids[2],c])
  await denied(ids[1], 'select ban_member($1,$2,true)', [s,ids[0]])
  await denied(ids[1], 'select ban_member($1,$2,true)', [s,ids[1]])
  await as(ids[2], 'select join_server($1)', [inv])
  await as(ids[0], "select manage_membership($1,$2,'promote')", [s,ids[2]])
  await denied(ids[1], 'select ban_member($1,$2,true)', [s,ids[2]])
  await as(ids[0], "select manage_membership($1,$2,'demote')", [s,ids[2]])
  await denied(ids[2], 'select ban_member($1,$2,true)', [s,ids[1]])
  await as(ids[1], 'select ban_member($1,$2,true)', [s,ids[2]])
  await denied(ids[2], 'select join_server($1)', [inv])
  assert.equal((await as(ids[2], 'select * from channels where server_id=$1', [s])).length,0)
  await as(ids[1], 'select ban_member($1,$2,false)', [s,ids[2]])
  await as(ids[2], 'select join_server($1)', [inv])
  await as(ids[0], 'select set_default_role($1,$2)', [s,extra])
  assert.equal((await as(ids[0], 'select id from roles where server_id=$1 and is_default', [s]))[0].id,extra)
  await as(ids[0], 'select set_default_role($1,null)', [s])
  assert.equal((await as(ids[0], 'select id from roles where server_id=$1 and is_default', [s])).length,0)
  assert.equal((await as(ids[1], 'update channels set archived=true where id=$1 returning id', [c])).length,1)
  await as(ids[0], 'delete from member_roles where server_id=$1 and user_id=$2 and role_id=$3', [s,ids[1],extra])
  assert.equal((await perms()).manage_channels,false)
  assert.equal((await perms()).send_messages,false)
  assert.ok(Object.values((await as(ids[0], 'select server_permissions($1) as p', [s]))[0].p).every(Boolean))
  assert.ok(Object.values((await as(ids[2], 'select server_permissions($1) as p', [server.id]))[0].p).every(v => v === false))
})
await test('Every public table has RLS and anon has no data grants', async () => {
  const tables = (
    await db.query(
      "select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'",
    )
  ).rows
  assert.equal(tables.length, 20)
  assert.ok(tables.every((t) => t.relrowsecurity))
  await db.exec('begin;set local role anon;')
  try {
    await assert.rejects(() => db.query('select * from public.profiles'))
  } finally {
    await db.exec('rollback')
  }
})
await db.close()
console.log(`\n${passed} PostgreSQL authorization scenarios passed.`)
