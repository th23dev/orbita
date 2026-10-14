-- Membership changes go through scoped functions; invitations never grant access by themselves.
alter table public.server_members add column access_role text not null default 'member'
  check (access_role in ('member','admin'));
drop policy members_owner_insert on public.server_members;
revoke insert on public.server_members from authenticated;
revoke insert(server_id,user_id) on public.server_members from authenticated;

create table public.channel_memberships (
  channel_id uuid not null,
  server_id uuid not null,
  user_id uuid not null,
  status text not null default 'accepted' check(status in ('accepted','left','removed')),
  role text not null default 'member' check(role in ('member','moderator')),
  primary key(channel_id,user_id),
  foreign key(channel_id,server_id) references public.channels(id,server_id) on delete cascade,
  foreign key(server_id,user_id) references public.server_members(server_id,user_id) on delete cascade
);
create index channel_memberships_user on public.channel_memberships(user_id,server_id);
create index channel_memberships_server on public.channel_memberships(server_id,user_id);
create table public.community_invites (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers on delete cascade,
  channel_id uuid,
  inviter_id uuid not null references public.profiles on delete cascade,
  invitee_id uuid not null references public.profiles on delete cascade,
  server_name text not null,
  channel_name text,
  expires_at timestamptz not null default now() + interval '7 days',
  foreign key(channel_id,server_id) references public.channels(id,server_id) on delete cascade,
  check(inviter_id <> invitee_id)
);
create unique index community_invites_target on public.community_invites(server_id,invitee_id,channel_id) nulls not distinct;
create index community_invites_recipient on public.community_invites(invitee_id);
create index community_invites_sender on public.community_invites(inviter_id);
create index community_invites_channel on public.community_invites(channel_id,server_id);
alter table public.channel_memberships enable row level security;
alter table public.community_invites enable row level security;
revoke all on public.channel_memberships,public.community_invites from public,anon,authenticated;
grant select on public.channel_memberships,public.community_invites to authenticated;

create function private.manage_server(s uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and (private.is_owner(s) or exists(select 1 from public.server_members where server_id=s and user_id=auth.uid() and access_role='admin'));
$$;
create function private.manage_channel(c uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.channels ch where ch.id=c and
    (private.manage_server(ch.server_id) or exists(select 1 from public.channel_memberships m where m.channel_id=c and m.user_id=auth.uid() and m.status='accepted' and m.role='moderator')));
$$;
create or replace function private.can_channel(c uuid) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.channels ch where ch.id=c and not ch.archived and private.is_member(ch.server_id) and
    (private.manage_server(ch.server_id) or (
      not exists(select 1 from public.channel_memberships m where m.channel_id=c and m.user_id=auth.uid() and m.status in ('left','removed')) and
      (not ch.is_private or exists(select 1 from public.channel_memberships m where m.channel_id=c and m.user_id=auth.uid() and m.status='accepted')
      or exists(select 1 from public.channel_member_permissions p where p.channel_id=c and p.user_id=auth.uid())
      or exists(select 1 from public.channel_permissions p join public.member_roles mr on mr.role_id=p.role_id and mr.server_id=p.server_id where p.channel_id=c and mr.user_id=auth.uid()))
    )));
$$;
create policy channel_memberships_read on public.channel_memberships for select to authenticated using(user_id=(select auth.uid()) or private.can_channel(channel_id));
create policy community_invites_read on public.community_invites for select to authenticated using(invitee_id=(select auth.uid()) or inviter_id=(select auth.uid()) or private.manage_server(server_id));
alter policy channels_read on public.channels using(private.can_channel(id) or private.manage_server(server_id));
alter policy channels_insert on public.channels with check(private.manage_server(server_id));
alter policy channels_update on public.channels using(private.manage_channel(id)) with check(private.manage_channel(id));

create function private.invite_member(s uuid, target_user uuid, c uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; sn text; cn text;
begin
  if auth.uid() is null or target_user=auth.uid() or not (case when c is null then private.manage_server(s) else private.manage_channel(c) end) then raise exception 'Sem permissão para convidar'; end if;
  select name into sn from public.servers where id=s;
  if c is not null then
    select name into cn from public.channels where id=c and server_id=s and not archived;
    if cn is null then raise exception 'Canal indisponível'; end if;
  end if;
  if not exists(select 1 from public.profiles where id=target_user) then raise exception 'Pessoa não encontrada'; end if;
  insert into public.community_invites(server_id,channel_id,inviter_id,invitee_id,server_name,channel_name)
  values(s,c,auth.uid(),target_user,sn,cn)
  on conflict(server_id,invitee_id,channel_id) do update set inviter_id=excluded.inviter_id,server_name=excluded.server_name,channel_name=excluded.channel_name,expires_at=now()+interval '7 days'
  returning id into result;
  return result;
end;
$$;
create function public.invite_member(s uuid,target_user uuid,c uuid default null) returns uuid language sql security invoker set search_path='' as $$ select private.invite_member(s,target_user,c); $$;
create function private.respond_invite(invite_id uuid, accept boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare inv public.community_invites;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta'; end if;
  select * into inv from public.community_invites where id=invite_id and invitee_id=auth.uid() for update;
  if inv.id is null then raise exception 'Convite indisponível'; end if;
  if accept then
    if inv.expires_at<=now() then raise exception 'Convite expirado'; end if;
    if not exists(select 1 from public.servers s where s.id=inv.server_id and (s.owner_id=inv.inviter_id
      or exists(select 1 from public.server_members m where m.server_id=s.id and m.user_id=inv.inviter_id and m.access_role='admin')
      or (inv.channel_id is not null and exists(select 1 from public.channel_memberships m where m.channel_id=inv.channel_id and m.user_id=inv.inviter_id and m.status='accepted' and m.role='moderator'))))
      then raise exception 'Quem convidou não tem mais permissão. Peça um novo convite.'; end if;
    if inv.channel_id is not null and not exists(select 1 from public.channels where id=inv.channel_id and not archived) then raise exception 'Canal indisponível'; end if;
    insert into public.server_members(server_id,user_id) values(inv.server_id,auth.uid()) on conflict do nothing;
    if inv.channel_id is not null then
      insert into public.channel_memberships(server_id,channel_id,user_id) values(inv.server_id,inv.channel_id,auth.uid())
      on conflict(channel_id,user_id) do update set status='accepted',role='member';
    end if;
  end if;
  delete from public.community_invites where id=inv.id;
  return inv.server_id;
end;
$$;
create function public.respond_invite(invite_id uuid,accept boolean) returns uuid language sql security invoker set search_path='' as $$ select private.respond_invite(invite_id,accept); $$;

create function private.manage_membership(s uuid,target_user uuid,action text,c uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare target_role text;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta'; end if;
  perform 1 from public.servers where id=s for update;
  if exists(select 1 from public.servers where id=s and owner_id=target_user) then raise exception 'O proprietário não pode sair ou ser removido'; end if;
  if not exists(select 1 from public.server_members where server_id=s and user_id=target_user) then raise exception 'Membro indisponível'; end if;
  if c is not null then
    if not exists(select 1 from public.channels where id=c and server_id=s and not archived) then raise exception 'Canal indisponível'; end if;
    if private.manage_server(s) and target_user=auth.uid() then raise exception 'Administradores mantêm acesso aos canais do servidor'; end if;
    if action='leave' then
      if target_user<>auth.uid() or not private.can_channel(c) then raise exception 'Sem permissão'; end if;
    else
      if not private.manage_channel(c) or target_user=auth.uid() then raise exception 'Sem permissão'; end if;
      if exists(select 1 from public.server_members where server_id=s and user_id=target_user and access_role='admin') then raise exception 'Gerencie administradores no servidor'; end if;
      if action in ('promote','demote') and not private.manage_server(s) then raise exception 'Somente administradores podem alterar cargos'; end if;
      if action not in ('remove','promote','demote') then raise exception 'Ação inválida'; end if;
      if action in ('promote','demote') and exists(select 1 from public.channel_memberships where channel_id=c and user_id=target_user and status<>'accepted') then raise exception 'A pessoa precisa aceitar um novo convite'; end if;
      if action in ('promote','demote') and not exists(select 1 from public.channel_memberships where channel_id=c and user_id=target_user and status='accepted') then
        -- Existing public/legacy members already consented by joining the server.
        if not exists(select 1 from public.channels ch where ch.id=c and not ch.is_private) and not exists(select 1 from public.channel_member_permissions where channel_id=c and user_id=target_user) then raise exception 'Convide a pessoa antes de atribuir um cargo'; end if;
      end if;
    end if;
    insert into public.channel_memberships(server_id,channel_id,user_id,status,role)
    values(s,c,target_user,case when action='leave' then 'left' when action='remove' then 'removed' else 'accepted' end,case when action='promote' then 'moderator' else 'member' end)
    on conflict(channel_id,user_id) do update set status=excluded.status,role=excluded.role;
    if action in ('remove','leave') then delete from public.community_invites where server_id=s and channel_id=c and invitee_id=target_user; end if;
  else
    select access_role into target_role from public.server_members where server_id=s and user_id=target_user;
    if action='leave' then
      if target_user<>auth.uid() then raise exception 'Sem permissão'; end if;
    elsif action in ('promote','demote') then
      if not private.is_owner(s) then raise exception 'Somente o proprietário pode alterar administradores'; end if;
      update public.server_members set access_role=case when action='promote' then 'admin' else 'member' end where server_id=s and user_id=target_user;
      return;
    elsif action='remove' then
      if not private.manage_server(s) or (target_role='admin' and not private.is_owner(s)) then raise exception 'Sem permissão'; end if;
    else raise exception 'Ação inválida'; end if;
    delete from public.community_invites where server_id=s and (invitee_id=target_user or inviter_id=target_user);
    delete from public.server_members where server_id=s and user_id=target_user;
  end if;
end;
$$;
create function public.manage_membership(s uuid,target_user uuid,action text,c uuid default null) returns void language sql security invoker set search_path='' as $$ select private.manage_membership(s,target_user,action,c); $$;

create function private.create_community(title text,description text,people uuid[],s uuid default null,channel_kind text default 'text',restricted boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; p uuid; sid uuid;
begin
  if auth.uid() is null or coalesce(cardinality(people),0)>50 then raise exception 'Convide até 50 amigos'; end if;
  foreach p in array coalesce(people,'{}'::uuid[]) loop
    if p is null or p=auth.uid() or not exists(select 1 from public.friendships where status='accepted' and ((requester_id=auth.uid() and addressee_id=p) or (addressee_id=auth.uid() and requester_id=p))) then raise exception 'Selecione amigos confirmados'; end if;
  end loop;
  if s is null then
    insert into public.servers(owner_id,name,description) values(auth.uid(),trim(title),trim(description)) returning id into result;
    sid=result;
  else
    if not private.manage_server(s) then raise exception 'Sem permissão'; end if;
    insert into public.channels(server_id,name,kind,topic,is_private) values(s,trim(title),channel_kind,trim(description),restricted) returning id into result;
    sid=s;
  end if;
  foreach p in array coalesce(people,'{}'::uuid[]) loop perform private.invite_member(sid,p,case when s is null then null else result end); end loop;
  return result;
end;
$$;
create function public.create_community(title text,description text,people uuid[],s uuid default null,channel_kind text default 'text',restricted boolean default false) returns uuid language sql security invoker set search_path='' as $$ select private.create_community(title,description,people,s,channel_kind,restricted); $$;

-- Keep old histories intact. The UI combines aliases into the canonical two-person conversation.
alter table public.direct_conversations add column canonical_id uuid references public.direct_conversations(id);
create index dm_canonical on public.direct_conversations(canonical_id);
with pairs as (
  select d.id,d.created_at,string_agg(m.user_id::text,',' order by m.user_id) as pair
  from public.direct_conversations d join public.direct_conversation_members m on m.conversation_id=d.id
  group by d.id having count(*)=2
), ranked as (
  select id,first_value(id) over(partition by pair order by created_at,id) as canonical from pairs
)
update public.direct_conversations d set canonical_id=r.canonical from ranked r where d.id=r.id and r.id<>r.canonical;
create or replace function private.create_dm(title text,people uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare d uuid; p uuid; participants uuid[];
begin
  if auth.uid() is null or coalesce(cardinality(people),0) not between 1 and 9 then raise exception 'Escolha de 1 a 9 amigos'; end if;
  select array_agg(distinct x order by x) into participants from unnest(people) x;
  foreach p in array people loop
    if p is null or p=auth.uid() or not exists(select 1 from public.friendships where status='accepted' and ((requester_id=auth.uid() and addressee_id=p) or (addressee_id=auth.uid() and requester_id=p))) then raise exception 'Convide apenas amigos confirmados'; end if;
  end loop;
  if cardinality(participants)=1 then
    perform pg_advisory_xact_lock(hashtextextended(least(auth.uid()::text,participants[1]::text)||greatest(auth.uid()::text,participants[1]::text),0));
    select dc.id into d from public.direct_conversations dc where dc.canonical_id is null and
      exists(select 1 from public.direct_conversation_members where conversation_id=dc.id and user_id=auth.uid()) and
      exists(select 1 from public.direct_conversation_members where conversation_id=dc.id and user_id=participants[1]) and
      (select count(*) from public.direct_conversation_members where conversation_id=dc.id)=2 order by dc.created_at,dc.id limit 1;
    if d is not null then return d; end if;
  end if;
  insert into public.direct_conversations(name,created_by) values(trim(title),auth.uid()) returning id into d;
  insert into public.direct_conversation_members(conversation_id,user_id) values(d,auth.uid());
  insert into public.direct_conversation_members(conversation_id,user_id) select d,unnest(participants);
  return d;
end;
$$;

revoke all on function private.manage_server(uuid),private.manage_channel(uuid),private.invite_member(uuid,uuid,uuid),private.respond_invite(uuid,boolean),private.manage_membership(uuid,uuid,text,uuid),private.create_community(text,text,uuid[],uuid,text,boolean) from public,anon,authenticated;
grant execute on function private.manage_server(uuid),private.manage_channel(uuid),private.invite_member(uuid,uuid,uuid),private.respond_invite(uuid,boolean),private.manage_membership(uuid,uuid,text,uuid),private.create_community(text,text,uuid[],uuid,text,boolean) to authenticated;
revoke all on function public.invite_member(uuid,uuid,uuid),public.respond_invite(uuid,boolean),public.manage_membership(uuid,uuid,text,uuid),public.create_community(text,text,uuid[],uuid,text,boolean) from public,anon;
grant execute on function public.invite_member(uuid,uuid,uuid),public.respond_invite(uuid,boolean),public.manage_membership(uuid,uuid,text,uuid),public.create_community(text,text,uuid[],uuid,text,boolean) to authenticated;
create function private.channel_people(c uuid) returns table(user_id uuid,role text) language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.can_channel(c) then raise exception 'Sem acesso ao canal'; end if;
  return query select sm.user_id,case when s.owner_id=sm.user_id then 'owner' when sm.access_role='admin' then 'admin' else coalesce(cm.role,'member') end
  from public.channels ch join public.servers s on s.id=ch.server_id join public.server_members sm on sm.server_id=s.id
  left join public.channel_memberships cm on cm.channel_id=ch.id and cm.user_id=sm.user_id
  where ch.id=c and (s.owner_id=sm.user_id or sm.access_role='admin' or (coalesce(cm.status,'accepted')='accepted' and
    (not ch.is_private or cm.status='accepted' or exists(select 1 from public.channel_member_permissions p where p.channel_id=c and p.user_id=sm.user_id)
      or exists(select 1 from public.channel_permissions p join public.member_roles mr on mr.role_id=p.role_id and mr.server_id=p.server_id where p.channel_id=c and mr.user_id=sm.user_id))));
end;
$$;
create function public.channel_people(c uuid) returns table(user_id uuid,role text) language sql security invoker set search_path='' as $$ select * from private.channel_people(c); $$;
revoke all on function private.channel_people(uuid),public.channel_people(uuid) from public,anon;
grant execute on function private.channel_people(uuid),public.channel_people(uuid) to authenticated;
alter publication supabase_realtime add table public.community_invites,public.channel_memberships;
