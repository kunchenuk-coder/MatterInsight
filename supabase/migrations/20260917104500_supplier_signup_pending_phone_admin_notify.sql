-- 材料商注册必须 pending / 未认证；把手机号写入 profiles.registered_phone；
-- 新材料商入驻后通知所有 admin（supplier_pending_review）。
-- 不改积分规则：Designer 1000 / Supplier 100 / Admin 0。

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'tag_added',
    'inquiry',
    'sample_request',
    'story_featured',
    'quote_received',
    'project_adoption_approved',
    'story_pending_review',
    'evaluation_added',
    'evaluation_disputed',
    'supplier_pending_review'
  ));

create or replace function public.create_notification(
  p_receiver_id uuid,
  p_type text,
  p_target_id uuid default null,
  p_sender_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_type text := lower(trim(coalesce(p_type, '')));
begin
  if p_receiver_id is null then
    raise exception 'receiver_id required';
  end if;

  if v_type not in (
    'tag_added',
    'inquiry',
    'sample_request',
    'story_featured',
    'quote_received',
    'project_adoption_approved',
    'story_pending_review',
    'evaluation_added',
    'evaluation_disputed',
    'supplier_pending_review'
  ) then
    raise exception 'invalid notification type';
  end if;

  if v_uid is null and not public.is_admin() then
    raise exception 'not authenticated';
  end if;

  insert into public.notifications (receiver_id, sender_id, type, target_id, is_read)
  values (
    p_receiver_id,
    coalesce(p_sender_id, v_uid),
    v_type,
    p_target_id,
    false
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_notification(uuid, text, uuid, uuid) to authenticated;

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
  v_points integer;
  v_company text;
  v_phone text;
begin
  v_username := split_part(coalesce(new.email, 'user'), '@', 1);
  v_role := coalesce(lower(new.raw_user_meta_data->>'role'), 'designer');
  if v_role not in ('designer', 'supplier', 'admin') then
    v_role := 'designer';
  end if;

  v_company := nullif(trim(coalesce(new.raw_user_meta_data->>'company', '')), '');
  v_phone := nullif(trim(coalesce(
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'registered_phone',
    ''
  )), '');

  if v_role = 'supplier' then
    v_status := 'pending';
    v_verified := false;
    v_points := 100;
  elsif v_role = 'designer' then
    v_status := 'approved';
    v_verified := true;
    v_points := 1000;
  else
    v_status := 'approved';
    v_verified := true;
    v_points := 0;
  end if;

  insert into public.profiles (
    id, email, role, username, status, is_verified, points, current_points,
    company, registered_phone
  )
  values (
    new.id,
    coalesce(new.email, ''),
    v_role,
    v_username,
    v_status,
    v_verified,
    v_points,
    v_points,
    v_company,
    v_phone
  )
  on conflict (id) do update
    set email = excluded.email,
        username = coalesce(public.profiles.username, excluded.username),
        role = excluded.role,
        status = excluded.status,
        is_verified = excluded.is_verified,
        company = coalesce(public.profiles.company, excluded.company),
        registered_phone = coalesce(public.profiles.registered_phone, excluded.registered_phone);
        -- 故意不更新 points / current_points / consumed_points

  return new;
end;
$$;

create or replace function public.notify_admins_supplier_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.role, '')) <> 'supplier' then
    return new;
  end if;
  if new.is_verified is true then
    return new;
  end if;

  begin
    insert into public.notifications (receiver_id, sender_id, type, target_id, is_read)
    select p.id, new.id, 'supplier_pending_review', new.id, false
    from public.profiles p
    where lower(p.role) = 'admin'
      and not exists (
        select 1
        from public.notifications n
        where n.receiver_id = p.id
          and n.type = 'supplier_pending_review'
          and n.target_id = new.id
          and n.is_read = false
      );
  exception when others then
    raise warning 'notify_admins_supplier_pending failed: %', sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists profiles_notify_supplier_pending on public.profiles;
create trigger profiles_notify_supplier_pending
  after insert on public.profiles
  for each row execute function public.notify_admins_supplier_pending();
