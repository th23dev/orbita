alter table public.roles add column permissions jsonb not null default '{"read_chat":true,"send_messages":true,"connect_voice":true,"speak":true,"share_screen":true,"use_camera":true,"manage_channels":false,"ban_members":false}'::jsonb,
  add column is_default boolean not null default false;
alter table public.roles add constraint valid_role_permissions check (jsonb_typeof(permissions)='object');
-- Validate every key and value, including false values (JSON containment alone is insufficient).
create function private.validate_role_permissions() returns trigger language plpgsql set search_path='' as $$
begin
  if jsonb_typeof(new.permissions)<>'object' or exists(select 1 from jsonb_each(new.permissions) p where p.key not in ('read_chat','send_messages','connect_voice','speak','share_screen','use_camera','manage_channels','ban_members') or jsonb_typeof(p.value)<>'boolean') then
    raise exception 'Permissões inválidas';
  end if;
  return new;
end; $$;
create trigger validate_role_permissions before insert or update on public.roles for each row execute function private.validate_role_permissions();
create unique index one_default_role_per_server on public.roles(server_id) where is_default;
grant insert(permissions), update(permissions) on public.roles to authenticated;

create function private.has_permission(s uuid, permission text) returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and private.is_member(s) and (
    private.manage_server(s) or
    exists(select 1 from public.member_roles mr join public.roles r on r.id=mr.role_id and r.server_id=mr.server_id
      where mr.server_id=s and mr.user_id=auth.uid() and r.permissions->permission='true'::jsonb) or
    (permission in ('read_chat','send_messages','connect_voice','speak','share_screen','use_camera') and
      not exists(select 1 from public.member_roles where server_id=s and user_id=auth.uid()))
  );
$$;
create function public.server_permissions(s uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_object_agg(p,private.has_permission(s,p)) from unnest(array['read_chat','send_messages','connect_voice','speak','share_screen','use_camera','manage_channels','ban_members']) p;
$$;
create function private.channel_permission(c uuid, permission text) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.channels where id=c and private.can_channel(c) and private.has_permission(server_id,permission));
$$;
create or replace function private.can_space(c uuid,d uuid) returns boolean language sql stable set search_path='' as $$
  select case when c is not null then private.channel_permission(c,'read_chat') else private.in_dm(d) end;
$$;
create policy messages_send_permission on public.messages as restrictive for insert to authenticated
  with check(channel_id is null or private.channel_permission(channel_id,'send_messages'));
create policy messages_edit_permission on public.messages as restrictive for update to authenticated
  using(channel_id is null or private.channel_permission(channel_id,'send_messages'))
  with check(channel_id is null or private.channel_permission(channel_id,'send_messages'));
create policy reactions_send_permission on public.message_reactions as restrictive for all to authenticated
  using(channel_id is null or private.channel_permission(channel_id,'read_chat'))
  with check(channel_id is null or (private.channel_permission(channel_id,'read_chat') and private.channel_permission(channel_id,'send_messages')));
create policy attachments_send_permission on public.attachments as restrictive for all to authenticated
  using(channel_id is null or private.channel_permission(channel_id,'read_chat'))
  with check(channel_id is null or (private.channel_permission(channel_id,'read_chat') and private.channel_permission(channel_id,'send_messages')));
alter policy channels_update on public.channels
  using(private.manage_channel(id) or private.channel_permission(id,'manage_channels'))
  with check(private.manage_channel(id) or private.has_permission(server_id,'manage_channels'));
alter policy channels_delete on public.channels
  using(private.is_member(server_id) and (private.manage_channel(id) or private.channel_permission(id,'manage_channels')));

create function private.set_default_role(s uuid, r uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_owner(s) then raise exception 'Somente o proprietário pode definir o cargo padrão'; end if;
  perform 1 from public.servers where id=s for update;
  if r is not null and not exists(select 1 from public.roles where id=r and server_id=s) then raise exception 'Cargo indisponível'; end if;
  update public.roles set is_default=false where server_id=s and is_default;
  update public.roles set is_default=true where server_id=s and id=r;
end; $$;
create function public.set_default_role(s uuid,r uuid) returns void language sql security invoker set search_path='' as $$ select private.set_default_role(s,r); $$;
create function private.assign_default_role() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.member_roles(server_id,user_id,role_id)
    select new.server_id,new.user_id,id from public.roles where server_id=new.server_id and is_default on conflict do nothing;
  return new;
end; $$;
create trigger assign_default_role after insert on public.server_members for each row execute function private.assign_default_role();

create table public.server_bans (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  banned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(server_id,user_id)
);
create index server_bans_user on public.server_bans(user_id);
create index server_bans_actor on public.server_bans(banned_by);
alter table public.server_bans enable row level security;
revoke all on public.server_bans from public,anon,authenticated;
grant select on public.server_bans to authenticated;
create policy bans_read on public.server_bans for select to authenticated using(private.has_permission(server_id,'ban_members'));
create function private.ban_member(s uuid,target_user uuid, banned boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.servers where id=s for update;
  if not private.has_permission(s,'ban_members') or target_user=auth.uid() then raise exception 'Sem permissão para banir'; end if;
  if exists(select 1 from public.servers where id=s and owner_id=target_user) or
    exists(select 1 from public.server_members where server_id=s and user_id=target_user and access_role='admin') then raise exception 'Não é possível banir o proprietário ou administradores'; end if;
  if banned then
    if not exists(select 1 from public.server_members where server_id=s and user_id=target_user) then raise exception 'Membro indisponível'; end if;
    insert into public.server_bans(server_id,user_id,banned_by) values(s,target_user,auth.uid()) on conflict do nothing;
    delete from public.community_invites where server_id=s and (invitee_id=target_user or inviter_id=target_user);
    delete from public.server_members where server_id=s and user_id=target_user;
  else
    delete from public.server_bans where server_id=s and user_id=target_user;
  end if;
end; $$;
create function public.ban_member(s uuid,target_user uuid,banned boolean) returns void language sql security invoker set search_path='' as $$ select private.ban_member(s,target_user,banned); $$;
create function private.reject_banned_member() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.servers where id=new.server_id for update;
  if exists(select 1 from public.server_bans where server_id=new.server_id and user_id=new.user_id) then raise exception 'Você foi banido deste servidor'; end if;
  return new;
end; $$;
create trigger reject_banned_member before insert on public.server_members for each row execute function private.reject_banned_member();

revoke all on function private.validate_role_permissions(),private.has_permission(uuid,text),private.channel_permission(uuid,text),private.set_default_role(uuid,uuid),private.assign_default_role(),private.ban_member(uuid,uuid,boolean),private.reject_banned_member() from public,anon,authenticated;
grant execute on function private.has_permission(uuid,text),private.channel_permission(uuid,text),private.set_default_role(uuid,uuid),private.ban_member(uuid,uuid,boolean) to authenticated;
revoke all on function public.server_permissions(uuid),public.set_default_role(uuid,uuid),public.ban_member(uuid,uuid,boolean) from public,anon;
grant execute on function public.server_permissions(uuid),public.set_default_role(uuid,uuid),public.ban_member(uuid,uuid,boolean) to authenticated;
