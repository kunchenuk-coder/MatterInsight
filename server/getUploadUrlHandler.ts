import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createPresignedUploadUrls,
  type AssetType,
} from './ossPresign';
import { verifySupabaseToken } from './verifySupabaseToken';

const ALLOWED_CATEGORIES = new Set([
  'materials',
  'variants',
  'project-photos',
  'verification',
  'local-materials',
  'general',
]);

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

export interface GetUploadUrlParams {
  fileName: string;
  contentType: string;
  category: string;
  assetType: AssetType;
}

function parseParams(
  req: IncomingMessage,
  body: Record<string, unknown>
): GetUploadUrlParams | null {
  const url = new URL(req.url ?? '/', 'http://localhost');

  const fileName =
    (typeof body.fileName === 'string' ? body.fileName : null) ??
    url.searchParams.get('fileName') ??
    'upload.jpg';

  const contentType =
    (typeof body.contentType === 'string' ? body.contentType : null) ??
    url.searchParams.get('contentType') ??
    'image/jpeg';

  const categoryRaw =
    (typeof body.category === 'string' ? body.category : null) ??
    url.searchParams.get('category') ??
    'general';

  const category = ALLOWED_CATEGORIES.has(categoryRaw) ? categoryRaw : 'general';

  const assetTypeRaw =
    (typeof body.assetType === 'string' ? body.assetType : null) ??
    url.searchParams.get('assetType') ??
    'image';

  const assetType: AssetType = assetTypeRaw === 'model_3d' ? 'model_3d' : 'image';

  if (!fileName.trim()) return null;
  return { fileName, contentType, category, assetType };
}

export async function handleGetUploadUrlRequest(
  req: IncomingMessage & { method?: string },
  res: ServerResponse
): Promise<void> {
  if (req.method !== 'POST' && req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const userId = await verifySupabaseToken(req.headers.authorization);
  if (!userId) {
    sendJson(res, 401, { error: '未登录或 token 无效' });
    return;
  }

  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: '请求体 JSON 无效' });
      return;
    }
  }

  const params = parseParams(req, body);
  if (!params) {
    sendJson(res, 400, { error: '缺少 fileName' });
    return;
  }

  try {
    const presigned = createPresignedUploadUrls(
      userId,
      params.category,
      params.fileName,
      params.contentType,
      params.assetType
    );

    sendJson(res, 200, {
      ...presigned,
      userId,
      assetType: params.assetType,
      category: params.category,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : '预签名失败';
    console.error('[get-upload-url]', message);
    sendJson(res, 500, { error: message });
  }
}

export function createGetUploadUrlMiddleware() {
  return (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ) => {
    if (!req.url?.startsWith('/api/get-upload-url')) {
      next();
      return;
    }
    void handleGetUploadUrlRequest(req, res);
  };
}
