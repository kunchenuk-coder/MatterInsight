-- Matter Insight：local_materials 增加 OSS 对象键与稳定资源 URL
-- 增量执行，不修改或删除 image_url 等已有字段

alter table public.local_materials
  add column if not exists oss_object_key text;

alter table public.local_materials
  add column if not exists asset_url text;

comment on column public.local_materials.oss_object_key is
  'OSS 对象键 users/{userId}/assets/...，用于按需生成预签名读取 URL';

comment on column public.local_materials.asset_url is
  '可选的稳定资源 URL；旧数据无此字段时仍使用 image_url';
