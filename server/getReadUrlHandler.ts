import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolvePublicOrSignedUrl } from './ossPresign';

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function normalizeObjectKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('users/')) return trimmed.split('?')[0].split('#')[0];
  try {
    const path = new URL(trimmed).pathname.replace(/^\//, '');
    if (path.startsWith('users/')) return path;
  } catch {
    const match = trimmed.match(/(users\/[^?#\s]+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * 为已上传 OSS 对象批量生成最新可读 URL（库材料/本地材料展示用）。
 * 无需登录：key 含随机 UUID，且 URL 本身有时效。
 */
export async function handleGetReadUrlRequest(
  req: IncomingMessage & { method?: string },
  res: ServerResponse
): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  let objectKeys: string[] = [];

  if (req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const single = url.searchParams.get('objectKey');
    if (single) objectKeys = [single];
  } else {
    try {
      const body = await readJsonBody(req);
      if (Array.isArray(body.objectKeys)) {
        objectKeys = body.objectKeys.filter((k): k is string => typeof k === 'string');
      } else if (typeof body.objectKey === 'string') {
        objectKeys = [body.objectKey];
      }
    } catch {
      sendJson(res, 400, { error: '请求体 JSON 无效' });
      return;
    }
  }

  const normalized = [
    ...new Set(
      objectKeys
        .map(normalizeObjectKey)
        .filter((k): k is string => !!k && k.startsWith('users/'))
    ),
  ];

  if (normalized.length === 0) {
    sendJson(res, 400, { error: '缺少有效的 objectKeys' });
    return;
  }

  if (normalized.length > 50) {
    sendJson(res, 400, { error: '单次最多 50 个 objectKey' });
    return;
  }

  try {
    const urls: Record<string, string> = {};
    for (const key of normalized) {
      urls[key] = resolvePublicOrSignedUrl(key);
    }
    sendJson(res, 200, { urls });
  } catch (e) {
    const message = e instanceof Error ? e.message : '生成读取 URL 失败';
    console.error('[get-read-url]', message);
    sendJson(res, 500, { error: message });
  }
}

export function createGetReadUrlMiddleware() {
  return (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ) => {
    if (!req.url?.startsWith('/api/get-read-url')) {
      next();
      return;
    }
    void handleGetReadUrlRequest(req, res);
  };
}
