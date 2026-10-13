-- Órbita: identity, membership, conversations, media, and scoped authorization.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,32}$'),
  display_name text not null check (char_length(display_name) between 1 and 64),
  bio text not null default '' check (char_length(bio) <= 500),
  avatar_path text,
  status text not null default 'online' check (status in ('online','busy','away','offline')),
  created_at timestamptz not null default now()
);
create table public.user_settings (
  user_id uuid primary key references public.profiles on delete cascade,
  theme text not null default 'dark' check (theme in ('dark','light')),
  notifications boolean not null default false,
  soundboard_volume real not null default 0.5 check (soundboard_volume between 0 and 1)
);
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles on delete cascade,
  addressee_id uuid not null references public.profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index friendships_pair on public.friendships (least(requester_id,addressee_id),greatest(requester_id,addressee_id));
create index friendships_receiver on public.friendships(addressee_id);
create index friendships_sender on public.friendships(requester_id);
create table public.servers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles,
  name text not null check (char_length(name) between 1 and 64),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now()
);
create index servers_owner on public.servers(owner_id);
create table public.server_members (
  server_id uuid not null references public.servers on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(server_id,user_id)
);
create index server_members_user on public.server_members(user_id,server_id);
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers on delete cascade,
  name text not null check (char_length(name) between 1 and 64),
  kind text not null check (kind in ('text','voice')),
  topic text not null default '' check (char_length(topic) <= 300),
  is_private boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique(id,server_id)
);
create index channels_server on public.channels(server_id);
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  color text not null default '#b7f36b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  unique(id,server_id)
);
create index roles_server on public.roles(server_id);
create table public.member_roles (
  server_id uuid not null,
  user_id uuid not null,
  role_id uuid not null,
  primary key(server_id,user_id,role_id),
  foreign key(server_id,user_id) references public.server_members on delete cascade,
  foreign key(role_id,server_id) references public.roles(id,server_id) on delete cascade
);
create index member_roles_role on public.member_roles(role_id,server_id);
create index member_roles_user on public.member_roles(user_id,server_id);
create table public.channel_permissions (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null,
  channel_id uuid not null,
  role_id uuid not null,
  foreign key(channel_id,server_id) references public.channels(id,server_id) on delete cascade,
  foreign key(role_id,server_id) references public.roles(id,server_id) on delete cascade,
  unique(channel_id,role_id)
);
create index channel_permissions_role on public.channel_permissions(role_id,server_id);
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers on delete cascade,
  created_by uuid not null references public.profiles,
  code uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '7 days',
  max_uses integer not null default 25 check (max_uses between 1 and 1000),
  uses integer not null default 0 check (uses >= 0 and uses <= max_uses)
);
create index invitations_server on public.invitations(server_id);
create index invitations_creator on public.invitations(created_by);
create table public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 64),
  created_by uuid not null references public.profiles,
  created_at timestamptz not null default now()
);
create index conversations_creator on public.direct_conversations(created_by);
create table public.direct_conversation_members (
  conversation_id uuid not null references public.direct_conversations on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  primary key(conversation_id,user_id)
);
create index dm_members_user on public.direct_conversation_members(user_id,conversation_id);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.channels on delete cascade,
  conversation_id uuid references public.direct_conversations on delete cascade,
  author_id uuid not null references public.profiles,
  content text not null default '' check (char_length(content) <= 4000),
  reply_to uuid references public.messages on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  search tsvector generated always as (to_tsvector('simple', content)) stored,
  check (num_nonnulls(channel_id,conversation_id) = 1)
);
create index messages_channel_history on public.messages(channel_id,created_at desc,id desc);
create index messages_dm_history on public.messages(conversation_id,created_at desc,id desc);
create index messages_author on public.messages(author_id);
create index messages_reply on public.messages(reply_to);
create index messages_search on public.messages using gin(search);
create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  channel_id uuid references public.channels on delete cascade,
  conversation_id uuid references public.direct_conversations on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  active boolean not null default true,
  unique(message_id,user_id,emoji)
);
create index reactions_user on public.message_reactions(user_id);
create index reactions_channel on public.message_reactions(channel_id);
create index reactions_dm on public.message_reactions(conversation_id);
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages on delete cascade,
  owner_id uuid not null references public.profiles,
  channel_id uuid references public.channels on delete cascade,
  conversation_id uuid references public.direct_conversations on delete cascade,
  path text not null unique,
  name text not null check (char_length(name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) <= 128),
  size bigint not null check (size between 1 and 26214400),
  ready boolean not null default false
);
create index attachments_message on public.attachments(message_id);
create index attachments_owner on public.attachments(owner_id);
create index attachments_channel on public.attachments(channel_id);
create index attachments_dm on public.attachments(conversation_id);
create table public.soundboard_sounds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 64),
  path text not null unique,
  mime_type text not null check (mime_type in ('audio/mpeg','audio/wav','audio/x-wav','audio/ogg')),
  size bigint not null check (size between 1 and 10485760),
  ready boolean not null default false
);
create index sounds_owner on public.soundboard_sounds(owner_id);

-- Private helpers prevent policy recursion. Every lookup is scoped to auth.uid().
create function private.is_member(s uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.server_members where server_id=s and user_id=auth.uid());
$$;
create function private.is_owner(s uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.servers where id=s and owner_id=auth.uid());
$$;
create function private.in_dm(c uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.direct_conversation_members where conversation_id=c and user_id=auth.uid());
$$;
create function private.can_channel(c uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.channels ch where ch.id=c and not ch.archived and private.is_member(ch.server_id)
    and (not ch.is_private or private.is_owner(ch.server_id) or exists (
      select 1 from public.channel_permissions p join public.member_roles mr on mr.role_id=p.role_id and mr.server_id=p.server_id
      where p.channel_id=c and mr.user_id=auth.uid()
    ))
  );
$$;
create function private.can_space(c uuid,d uuid) returns boolean language sql stable set search_path = '' as $$
  select case when c is not null then private.can_channel(c) when d is not null then private.in_dm(d) else false end;
$$;
create function private.can_message(m uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.messages where id=m and deleted_at is null and private.can_space(channel_id,conversation_id));
$$;

create function private.new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,username,display_name) values (new.id,'u_'||left(replace(new.id::text,'-',''),30),left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'Explorador'),64));
  insert into public.user_settings(user_id) values(new.id);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.new_user();

create function private.new_server() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or new.owner_id <> auth.uid() then raise exception 'Não autorizado'; end if;
  insert into public.server_members(server_id,user_id) values(new.id,new.owner_id);
  insert into public.channels(server_id,name,kind,topic) values(new.id,'geral','text','O começo de boas conversas.'),(new.id,'Sala de estar','voice','Chegue mais.');
  return new;
end;
$$;
create trigger server_defaults after insert on public.servers for each row execute function private.new_server();

create function private.message_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if new.reply_to is not null and not exists(select 1 from public.messages m where m.id=new.reply_to and m.channel_id is not distinct from new.channel_id and m.conversation_id is not distinct from new.conversation_id and m.deleted_at is null) then raise exception 'Resposta fora da conversa'; end if;
    if new.channel_id is not null and not exists(select 1 from public.channels where id=new.channel_id and kind='text') then raise exception 'Use um canal de texto'; end if;
    new.created_at=now(); new.edited_at=null; new.deleted_at=null;
  else
    if old.deleted_at is not null then raise exception 'Mensagem já excluída'; end if;
    new.edited_at=now();
    if new.deleted_at is not null then new.content=''; new.deleted_at=now(); end if;
  end if;
  return new;
end;
$$;
create trigger guard_message before insert or update on public.messages for each row execute function private.message_guard();
create function private.child_scope() returns trigger language plpgsql set search_path = '' as $$
declare m public.messages;
begin
  select * into m from public.messages where id=new.message_id and deleted_at is null;
  if m.id is null then raise exception 'Mensagem indisponível'; end if;
  new.channel_id=m.channel_id; new.conversation_id=m.conversation_id;
  if tg_table_name='attachments' then
    if m.author_id<>auth.uid() or new.path <> auth.uid()::text||'/'||new.id::text then raise exception 'Anexo inválido'; end if;
  end if;
  return new;
end;
$$;
create trigger reaction_scope before insert on public.message_reactions for each row execute function private.child_scope();
create trigger attachment_scope before insert on public.attachments for each row execute function private.child_scope();

create function private.join_server(invite_code uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invitations;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta'; end if;
  select * into inv from public.invitations where code=invite_code for update;
  if inv.id is null or inv.expires_at<=now() or inv.uses>=inv.max_uses then raise exception 'Convite inválido ou expirado'; end if;
  if not private.is_member(inv.server_id) then
    insert into public.server_members(server_id,user_id) values(inv.server_id,auth.uid());
    update public.invitations set uses=uses+1 where id=inv.id;
  end if;
  return inv.server_id;
end;
$$;
create function public.join_server(invite_code uuid) returns uuid language sql security invoker set search_path = '' as $$ select private.join_server(invite_code); $$;
create function private.create_dm(title text, people uuid[]) returns uuid language plpgsql security definer set search_path = '' as $$
declare d uuid; p uuid;
begin
  if auth.uid() is null or coalesce(cardinality(people),0) not between 1 and 9 then raise exception 'Escolha de 1 a 9 amigos'; end if;
  foreach p in array people loop
    if p is null or p=auth.uid() or not exists(select 1 from public.friendships where status='accepted' and ((requester_id=auth.uid() and addressee_id=p) or (addressee_id=auth.uid() and requester_id=p))) then raise exception 'Convide apenas amigos confirmados'; end if;
  end loop;
  insert into public.direct_conversations(name,created_by) values(title,auth.uid()) returning id into d;
  insert into public.direct_conversation_members(conversation_id,user_id) values(d,auth.uid());
  insert into public.direct_conversation_members(conversation_id,user_id) select d,unnest(people) on conflict do nothing;
  return d;
end;
$$;
create function public.create_dm(title text,people uuid[]) returns uuid language sql security invoker set search_path = '' as $$ select private.create_dm(title,people); $$;

-- Explicit table and column grants: immutable IDs, ownership and scope cannot be reassigned.
do $$ declare t text; begin
  foreach t in array array['profiles','user_settings','friendships','servers','server_members','channels','roles','member_roles','channel_permissions','invitations','direct_conversations','direct_conversation_members','messages','message_reactions','attachments','soundboard_sounds'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;
grant update(username,display_name,bio,avatar_path,status) on public.profiles to authenticated;
grant update(theme,notifications,soundboard_volume) on public.user_settings to authenticated;
grant insert(requester_id,addressee_id),delete on public.friendships to authenticated;
grant update(status) on public.friendships to authenticated;
grant insert(owner_id,name,description) on public.servers to authenticated;
grant update(name,description) on public.servers to authenticated;
grant insert(server_id,name,kind,topic,is_private) on public.channels to authenticated;
grant update(name,topic,is_private,archived) on public.channels to authenticated;
grant insert(server_id,name,color),delete on public.roles to authenticated;
grant update(name,color) on public.roles to authenticated;
grant insert,delete on public.member_roles,public.channel_permissions to authenticated;
grant insert(server_id,created_by,expires_at,max_uses),delete on public.invitations to authenticated;
grant insert(id,channel_id,conversation_id,author_id,content,reply_to) on public.messages to authenticated;
grant update(content,deleted_at) on public.messages to authenticated;
grant insert(message_id,user_id,emoji,active) on public.message_reactions to authenticated;
grant update(active) on public.message_reactions to authenticated;
grant insert(id,message_id,owner_id,path,name,mime_type,size),delete on public.attachments to authenticated;
grant update(ready) on public.attachments to authenticated;
grant insert(id,owner_id,name,path,mime_type,size),delete on public.soundboard_sounds to authenticated;
grant update(name,ready) on public.soundboard_sounds to authenticated;

-- Profiles are an authenticated directory, containing no emails or private settings.
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()) and (avatar_path is null or split_part(avatar_path,'/',1)=(select auth.uid())::text));
create policy settings_read on public.user_settings for select to authenticated using(user_id=(select auth.uid()));
create policy settings_update on public.user_settings for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy friendships_read on public.friendships for select to authenticated using((select auth.uid()) in (requester_id,addressee_id));
create policy friendships_insert on public.friendships for insert to authenticated with check(requester_id=(select auth.uid()) and status='pending');
create policy friendships_accept on public.friendships for update to authenticated using(addressee_id=(select auth.uid()) and status='pending') with check(addressee_id=(select auth.uid()) and status='accepted');
create policy friendships_delete on public.friendships for delete to authenticated using((select auth.uid()) in (requester_id,addressee_id));
create policy servers_read on public.servers for select to authenticated using(private.is_member(id) or owner_id=(select auth.uid()));
create policy servers_insert on public.servers for insert to authenticated with check(owner_id=(select auth.uid()));
create policy servers_update on public.servers for update to authenticated using(private.is_owner(id)) with check(owner_id=(select auth.uid()));
create policy members_read on public.server_members for select to authenticated using(private.is_member(server_id));
create policy channels_read on public.channels for select to authenticated using(private.can_channel(id) or private.is_owner(server_id));
create policy channels_insert on public.channels for insert to authenticated with check(private.is_owner(server_id));
create policy channels_update on public.channels for update to authenticated using(private.is_owner(server_id)) with check(private.is_owner(server_id));
create policy roles_read on public.roles for select to authenticated using(private.is_member(server_id));
create policy roles_write on public.roles for all to authenticated using(private.is_owner(server_id)) with check(private.is_owner(server_id));
create policy member_roles_read on public.member_roles for select to authenticated using(private.is_member(server_id));
create policy member_roles_write on public.member_roles for all to authenticated using(private.is_owner(server_id)) with check(private.is_owner(server_id));
create policy permissions_read on public.channel_permissions for select to authenticated using(private.is_member(server_id));
create policy permissions_write on public.channel_permissions for all to authenticated using(private.is_owner(server_id)) with check(private.is_owner(server_id));
create policy invitations_read on public.invitations for select to authenticated using(private.is_owner(server_id));
create policy invitations_insert on public.invitations for insert to authenticated with check(private.is_owner(server_id) and created_by=(select auth.uid()) and expires_at>now() and expires_at<=now()+interval '30 days');
create policy invitations_delete on public.invitations for delete to authenticated using(private.is_owner(server_id));
create policy dm_read on public.direct_conversations for select to authenticated using(private.in_dm(id));
create policy dm_members_read on public.direct_conversation_members for select to authenticated using(private.in_dm(conversation_id));
create policy messages_read on public.messages for select to authenticated using(private.can_space(channel_id,conversation_id));
create policy messages_insert on public.messages for insert to authenticated with check(author_id=(select auth.uid()) and private.can_space(channel_id,conversation_id));
create policy messages_update on public.messages for update to authenticated using(author_id=(select auth.uid()) and private.can_space(channel_id,conversation_id)) with check(author_id=(select auth.uid()) and private.can_space(channel_id,conversation_id));
create policy reactions_read on public.message_reactions for select to authenticated using(private.can_message(message_id));
create policy reactions_insert on public.message_reactions for insert to authenticated with check(user_id=(select auth.uid()) and private.can_message(message_id));
create policy reactions_update on public.message_reactions for update to authenticated using(user_id=(select auth.uid()) and private.can_message(message_id)) with check(user_id=(select auth.uid()) and private.can_message(message_id));
create policy attachments_read on public.attachments for select to authenticated using(private.can_message(message_id));
create policy attachments_insert on public.attachments for insert to authenticated with check(owner_id=(select auth.uid()) and private.can_message(message_id));
create policy attachments_update on public.attachments for update to authenticated using(owner_id=(select auth.uid()) and private.can_message(message_id)) with check(owner_id=(select auth.uid()) and private.can_message(message_id));
create policy attachments_delete on public.attachments for delete to authenticated using(owner_id=(select auth.uid()));
create policy sounds_read on public.soundboard_sounds for select to authenticated using(owner_id=(select auth.uid()));
create policy sounds_insert on public.soundboard_sounds for insert to authenticated with check(owner_id=(select auth.uid()) and path=(select auth.uid())::text||'/'||id::text);
create policy sounds_update on public.soundboard_sounds for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy sounds_delete on public.soundboard_sounds for delete to authenticated using(owner_id=(select auth.uid()));

-- No public file buckets. Never render HTML/SVG as active content in the app.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('attachments','attachments',false,26214400,null),
('sounds','sounds',false,10485760,array['audio/mpeg','audio/wav','audio/x-wav','audio/ogg']),
('avatars','avatars',false,2097152,array['image/jpeg','image/png','image/webp']);
create policy objects_read on storage.objects for select to authenticated using(
  (bucket_id='avatars') or
  (bucket_id='attachments' and exists(select 1 from public.attachments a where a.path=storage.objects.name and (a.ready or a.owner_id=(select auth.uid())) and private.can_message(a.message_id))) or
  (bucket_id='sounds' and exists(select 1 from public.soundboard_sounds s where s.path=storage.objects.name and s.owner_id=(select auth.uid())))
);
create policy objects_insert on storage.objects for insert to authenticated with check(
  split_part(name,'/',1)=(select auth.uid())::text and (
    (bucket_id='avatars') or
    (bucket_id='attachments' and exists(select 1 from public.attachments a where a.path=storage.objects.name and a.owner_id=(select auth.uid()) and not a.ready and private.can_message(a.message_id))) or
    (bucket_id='sounds' and exists(select 1 from public.soundboard_sounds s where s.path=storage.objects.name and s.owner_id=(select auth.uid()) and not s.ready))
  )
);
create policy objects_delete on storage.objects for delete to authenticated using(bucket_id in ('avatars','sounds','attachments') and split_part(name,'/',1)=(select auth.uid())::text);

create function private.can_topic(t text) returns boolean language plpgsql stable set search_path = '' as $$
declare scope text; ident uuid;
begin
  if auth.uid() is null then return false; end if;
  scope=split_part(t,':',1);
  begin ident=split_part(t,':',2)::uuid; exception when invalid_text_representation then return false; end;
  return case scope when 'channel' then private.can_channel(ident) when 'dm' then private.in_dm(ident) when 'server' then private.is_member(ident) else false end;
end;
$$;
create policy orbita_realtime_read on realtime.messages for select to authenticated using(private.can_topic((select realtime.topic())) and extension in ('broadcast','presence'));
create policy orbita_realtime_write on realtime.messages for insert to authenticated with check(private.can_topic((select realtime.topic())) and extension in ('broadcast','presence'));

-- Soft deletion produces authorized UPDATE events. Physical deletes carry only keys.
do $$ declare t text; begin
  foreach t in array array['profiles','user_settings','friendships','servers','server_members','channels','roles','member_roles','channel_permissions','direct_conversations','direct_conversation_members','messages','message_reactions','attachments','soundboard_sounds'] loop
    execute format('alter publication supabase_realtime add table public.%I',t);
  end loop;
end $$;

revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.is_member(uuid),private.is_owner(uuid),private.in_dm(uuid),private.can_channel(uuid),private.can_space(uuid,uuid),private.can_message(uuid),private.can_topic(text),private.join_server(uuid),private.create_dm(text,uuid[]) to authenticated;
revoke all on function public.join_server(uuid),public.create_dm(text,uuid[]) from public,anon;
grant execute on function public.join_server(uuid),public.create_dm(text,uuid[]) to authenticated;
