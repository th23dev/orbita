-- Server identity is owner-managed; private images are readable by members only.
alter table public.servers add column icon_path text
  check (icon_path is null or (split_part(icon_path,'/',1)=id::text and char_length(icon_path)<=200));
grant update(icon_path) on public.servers to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('server-icons','server-icons',false,2097152,array['image/jpeg','image/png','image/webp']);

-- Text comparison avoids casting untrusted object paths to UUIDs.
create policy server_icons_read on storage.objects for select to authenticated using (
  bucket_id='server-icons' and exists (
    select 1 from public.server_members m where m.server_id::text=split_part(storage.objects.name,'/',1) and m.user_id=(select auth.uid())
  )
);
create policy server_icons_insert on storage.objects for insert to authenticated with check (
  bucket_id='server-icons' and exists (
    select 1 from public.servers s where s.id::text=split_part(storage.objects.name,'/',1) and s.owner_id=(select auth.uid())
  )
);
create policy server_icons_delete on storage.objects for delete to authenticated using (
  bucket_id='server-icons' and exists (
    select 1 from public.servers s where s.id::text=split_part(storage.objects.name,'/',1) and s.owner_id=(select auth.uid())
  )
);

-- Explicit per-member access complements existing role grants. Only owners can grant access.
create table public.channel_member_permissions (
  server_id uuid not null,
  channel_id uuid not null,
  user_id uuid not null,
  primary key(channel_id,user_id),
  foreign key(channel_id,server_id) references public.channels(id,server_id) on delete cascade,
  foreign key(server_id,user_id) references public.server_members(server_id,user_id) on delete cascade
);
create index channel_member_permissions_channel_server on public.channel_member_permissions(channel_id,server_id);
create index channel_member_permissions_member on public.channel_member_permissions(server_id,user_id);
alter table public.channel_member_permissions enable row level security;
revoke all on public.channel_member_permissions from anon,authenticated;
grant select,insert,delete on public.channel_member_permissions to authenticated;
create policy member_access_read on public.channel_member_permissions for select to authenticated
  using(private.is_member(server_id));
create policy member_access_insert on public.channel_member_permissions for insert to authenticated
  with check(private.is_owner(server_id));
create policy member_access_delete on public.channel_member_permissions for delete to authenticated
  using(private.is_owner(server_id));

create or replace function private.can_channel(c uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.channels ch where ch.id=c and not ch.archived and private.is_member(ch.server_id)
    and (not ch.is_private or private.is_owner(ch.server_id) or exists (
      select 1 from public.channel_permissions p join public.member_roles mr on mr.role_id=p.role_id and mr.server_id=p.server_id
      where p.channel_id=c and mr.user_id=auth.uid()
    ) or exists (
      select 1 from public.channel_member_permissions p where p.channel_id=c and p.user_id=auth.uid()
    ))
  );
$$;
alter publication supabase_realtime add table public.channel_member_permissions;

