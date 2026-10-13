-- Cover the composite foreign key and avoid running duplicate SELECT policies.
-- Filename matches the version recorded by the hosted migration runner.
create index channel_permissions_channel_server on public.channel_permissions(channel_id,server_id);

drop policy roles_write on public.roles;
create policy roles_insert on public.roles for insert to authenticated with check(private.is_owner(server_id));
create policy roles_update on public.roles for update to authenticated using(private.is_owner(server_id)) with check(private.is_owner(server_id));
create policy roles_delete on public.roles for delete to authenticated using(private.is_owner(server_id));

drop policy member_roles_write on public.member_roles;
create policy member_roles_insert on public.member_roles for insert to authenticated with check(private.is_owner(server_id));
create policy member_roles_delete on public.member_roles for delete to authenticated using(private.is_owner(server_id));

drop policy permissions_write on public.channel_permissions;
create policy permissions_insert on public.channel_permissions for insert to authenticated with check(private.is_owner(server_id));
create policy permissions_delete on public.channel_permissions for delete to authenticated using(private.is_owner(server_id));
