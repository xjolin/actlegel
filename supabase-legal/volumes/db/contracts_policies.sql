do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'contracts_select'
  ) then
    create policy contracts_select
      on storage.objects
      for select
      to anon, authenticated, service_role
      using (bucket_id = 'contracts');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'contracts_insert'
  ) then
    create policy contracts_insert
      on storage.objects
      for insert
      to anon, authenticated, service_role
      with check (bucket_id = 'contracts');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'contracts_delete'
  ) then
    create policy contracts_delete
      on storage.objects
      for delete
      to anon, authenticated, service_role
      using (bucket_id = 'contracts');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'buckets'
      and policyname = 'contracts_buckets_select'
  ) then
    create policy contracts_buckets_select
      on storage.buckets
      for select
      to anon, authenticated, service_role
      using (id = 'contracts');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'buckets'
      and policyname = 'contracts_buckets_insert'
  ) then
    create policy contracts_buckets_insert
      on storage.buckets
      for insert
      to anon, authenticated, service_role
      with check (id = 'contracts');
  end if;
end $$;
