-- Homepage banner subtitle (max 50 chars). Additive; does not change review RPCs besides copy-on-resubmit.

alter table public.topic_article_versions
  add column if not exists subtitle text not null default '';

alter table public.topic_article_versions
  drop constraint if exists topic_article_versions_subtitle_len;
alter table public.topic_article_versions
  add constraint topic_article_versions_subtitle_len
  check (char_length(subtitle) <= 50);

create or replace function public.submit_topic_article_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_ver public.topic_article_versions%rowtype;
  v_article public.topic_articles%rowtype;
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_version_id is null then
    raise exception 'version_id required';
  end if;

  select lower(role) into v_role from public.profiles where id = v_uid;
  if v_role is distinct from 'supplier' then
    raise exception 'only suppliers may submit topics';
  end if;

  perform set_config('app.topic_status_ok', 'on', true);

  select * into v_ver
  from public.topic_article_versions
  where id = p_version_id
  for update;
  if not found then
    raise exception 'version not found';
  end if;

  select * into v_article
  from public.topic_articles
  where id = v_ver.article_id
  for update;
  if not found or v_article.supplier_id is distinct from v_uid then
    raise exception 'not allowed';
  end if;
  if v_article.is_archived then
    raise exception 'archived topics cannot be submitted';
  end if;

  if length(trim(v_ver.title)) < 1 then
    raise exception 'title required';
  end if;
  if length(trim(v_ver.subtitle)) < 1 then
    raise exception 'subtitle required';
  end if;
  if not public.topic_version_has_publishable_body(v_ver.content) then
    raise exception 'content required';
  end if;

  if v_ver.status = 'draft' then
    update public.topic_article_versions
    set
      status = 'pending_review',
      submitted_at = now(),
      rejection_reason = null,
      updated_at = now()
    where id = v_ver.id;
    return jsonb_build_object('ok', true, 'version_id', v_ver.id, 'status', 'pending_review');
  end if;

  if v_ver.status = 'rejected' then
    insert into public.topic_article_versions (
      article_id, title, subtitle, content, cover_image_object_key, status, submitted_at
    ) values (
      v_ver.article_id, v_ver.title, v_ver.subtitle, v_ver.content, v_ver.cover_image_object_key,
      'pending_review', now()
    )
    returning id into v_new_id;
    return jsonb_build_object('ok', true, 'version_id', v_new_id, 'status', 'pending_review');
  end if;

  raise exception 'only draft or rejected versions can be submitted';
end;
$$;
