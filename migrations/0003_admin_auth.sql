-- 0003 — Supabase Auth: peran editor, admin ketat, audit read untuk editor.
--
-- Berkas 0001/0002 sengaja tidak diubah: database yang sudah menerapkan
-- keduanya harus mendapat perubahan yang sama lewat migrasi baru ini.
--
-- `alter type ... add value` dan pemakaian nilai baru dalam transaksi yang sama
-- dapat ditolak PostgreSQL, karena itu fungsi di bawah membandingkan
-- `role::text`, bukan literal enum `'editor'`.

alter type animebattle.user_role_t add value if not exists 'editor';

-- is_admin() lama memasukkan curator. Itu membuat curator dapat mengubah
-- sumber/role/audit; sekarang admin berarti admin/owner saja.
create or replace function animebattle.is_admin()
returns boolean
language sql
security definer
set search_path = animebattle, public
stable
as $$
  select exists (
    select 1 from animebattle.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'owner')
  )
$$;

create or replace function animebattle.is_editor()
returns boolean
language sql
security definer
set search_path = animebattle, public
stable
as $$
  select exists (
    select 1 from animebattle.user_roles
    where user_id = auth.uid()
      and role::text in ('editor', 'curator', 'admin', 'owner')
  )
$$;

revoke execute on function animebattle.is_editor() from public;
grant execute on function animebattle.is_admin() to authenticated;
grant execute on function animebattle.is_editor() to authenticated;

-- Curator/editor boleh membaca audit untuk pekerjaan kurasi, tetapi tidak boleh
-- menulis/menghapusnya. Policy all admin yang ada tetap berlaku untuk admin.
create policy pol_audit_logs_editor_read
  on animebattle.audit_logs
  for select
  to authenticated
  using (is_editor());
