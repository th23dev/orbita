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
await test('Only the server owner can add existing users directly', async () => {
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
  await as(ids[0], insert, [target.id, ids[1]])
  assert.equal((await as(ids[1], 'select * from servers where id=$1', [target.id])).length, 1)
  await denied(ids[1], insert, [target.id, ids[2]])
  await as(ids[0], insert, [target.id, ids[2]])
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
await test('Every public table has RLS and anon has no data grants', async () => {
  const tables = (
    await db.query(
      "select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'",
    )
  ).rows
  assert.equal(tables.length, 17)
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
