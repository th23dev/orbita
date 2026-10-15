-- Reuse the existing channel-management authority; regular members cannot delete.
grant delete on public.channels to authenticated;
create policy channels_delete on public.channels
for delete to authenticated
using (private.is_member(server_id) and private.manage_channel(id));
