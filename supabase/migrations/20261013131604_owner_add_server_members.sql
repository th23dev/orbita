-- An owner may add an existing profile to their own server. Members cannot add
-- themselves or others, and no client can edit ownership or membership fields.
grant insert(server_id,user_id) on public.server_members to authenticated;
create policy members_owner_insert on public.server_members for insert to authenticated
  with check(private.is_owner(server_id));
