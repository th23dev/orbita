-- Only the owner can permanently remove a server. Existing foreign keys cascade its contents.
grant delete on public.servers to authenticated;
create policy servers_delete on public.servers
for delete to authenticated
using (owner_id = (select auth.uid()));
