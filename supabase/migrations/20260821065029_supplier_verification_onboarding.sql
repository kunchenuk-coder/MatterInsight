-- 材料商入驻必须走审核：禁止 handle_new_user 把供应商写成 approved + is_verified=true。
-- 同时用 BEFORE UPDATE 保护 status / is_verified，非管理员不能自行通过认证。

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
  v_role text;
  v_status text;
  v_verified boolean;
begin
  v_username := split_part(coalesce(new.email, 'user'), '@', 1);
  v_role := coalesce(lower(new.raw_user_meta_data->>'role'), 'designer');
  if v_role not in ('designer', 'supplier', 'admin') then
    v_role := 'designer';
  end if;

  if v_role = 'supplier' then
    v_status := 'pending';
    v_verified := false;
  else
    v_status := 'approved';
    v_verified := true;
  end if;

  insert into public.profiles (id, email, role, username, status, is_verified)
  values (
    new.id,
    coalesce(new.email, ''),
    v_role,
    v_username,
    v_status,
    v_verified
  )
  on conflict (id) do update
    set email = excluded.email,
        username = coalesce(public.profiles.username, excluded.username),
        role = excluded.role,
        status = excluded.status,
        is_verified = excluded.is_verified;

  return new;
end;
$$;

create or replace function public.profiles_apply_role_defaults()
returns trigger
language plpgsql
as $$
declare
  v_role text;
begin
  v_role := lower(coalesce(new.role, ''));
  if v_role = 'designer' then
    if new.status is null then new.status := 'approved'; end if;
    if new.is_verified is null then new.is_verified := true; end if;
  elsif v_role = 'supplier' then
    if new.status is null then new.status := 'pending'; end if;
    if new.is_verified is null then new.is_verified := false; end if;
  elsif v_role = 'admin' then
    if new.status is null then new.status := 'approved'; end if;
    if new.is_verified is null then new.is_verified := true; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_role_defaults on public.profiles;
create trigger profiles_role_defaults
  before insert on public.profiles
  for each row execute function public.profiles_apply_role_defaults();

-- 先回填，再装保护触发器：迁移角色下 auth.uid() 为空，is_admin() 为 false。
update public.profiles p
set status = 'pending',
    is_verified = false
where lower(p.role) = 'supplier'
  and p.is_verified is true
  and coalesce(nullif(trim(p.verification_doc_url), ''), '') = ''
  and not exists (
    select 1
    from public.materials m
    where m.supplier_id = p.id
  );

create or replace function public.profiles_protect_verification_fields()
returns trigger
language plpgsql
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  new.status := old.status;
  new.is_verified := old.is_verified;
  return new;
end;
$$;

drop trigger if exists profiles_protect_verification_fields on public.profiles;
create trigger profiles_protect_verification_fields
  before update of status, is_verified on public.profiles
  for each row execute function public.profiles_protect_verification_fields();
