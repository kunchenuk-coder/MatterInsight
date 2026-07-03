-- 修正「蓝色木纹」材料：清除 data.image 中过期的 OSS 签名 URL，统一依赖 oss_object_key 刷新
-- 根因：Vercel HTTPS 页面无法加载 http:// 过期签名 URL；灰色瓷砖因 data:URL 不受影响

update public.materials m
set
  oss_object_key = coalesce(
    nullif(m.oss_object_key, ''),
    substring(m.data->>'image' from 'users/[^?#]+')
  ),
  data = jsonb_set(
    jsonb_set(
      coalesce(m.data, '{}'::jsonb),
      '{ossObjectKey}',
      to_jsonb(
        coalesce(
          nullif(m.oss_object_key, ''),
          substring(m.data->>'image' from 'users/[^?#]+')
        )
      ),
      true
    ),
    '{image}',
    '""'::jsonb,
    true
  )
where m.id = '95e5806b-b8cf-4d42-8c76-12a9cb0b298d'
   or (m.data->>'name' = '蓝色木纹' and m.data->>'image' like '%aliyuncs.com%');
