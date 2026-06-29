import multer from 'multer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { putUserAssetToOss, type AssetType } from './ossPresign';
import { verifySupabaseToken } from './verifySupabaseToken';

/**
 * 服务端代理上传：浏览器把（已压缩的）文件 POST 到这里，后端用 OSS SDK 直传私有桶。
 * 用于绕开浏览器直传 OSS 的 CORS 限制（presigned PUT 被拦截时的兜底路径）。
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

type MulterRequest = IncomingMessage & {
  file?: Express.Multer.File;
};

const ALLOWED_CATEGORIES = new Set([
  'materials',
  'variants',
  'project-photos',
  'verification',
  'local-materials',
  'avatars',
  'general',
]);

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function resolveParams(req: IncomingMessage): {
  category: string;
  assetType: AssetType;
} {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const categoryRaw = url.searchParams.get('category') ?? 'general';
  const category = ALLOWED_CATEGORIES.has(categoryRaw) ? categoryRaw : 'general';
  const assetType: AssetType =
    url.searchParams.get('assetType') === 'model_3d' ? 'model_3d' : 'image';
  return { category, assetType };
}

async function process(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    // multer 类型与 Node IncomingMessage 不完全兼容，运行时正常
    upload.single('file')(req as never, res as never, async (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : '文件解析失败';
        sendJson(res, 400, { error: msg });
        resolve();
        return;
      }

      const userId = await verifySupabaseToken(req.headers.authorization);
      if (!userId) {
        sendJson(res, 401, { error: '未登录或 token 无效' });
        resolve();
        return;
      }

      const mreq = req as MulterRequest;
      if (!mreq.file) {
        sendJson(res, 400, { error: '未收到文件' });
        resolve();
        return;
      }

      const { category, assetType } = resolveParams(req);
      const contentType = mreq.file.mimetype || 'image/jpeg';

      try {
        const result = await putUserAssetToOss(
          userId,
          category,
          mreq.file.originalname || 'upload.jpg',
          contentType,
          assetType,
          mreq.file.buffer
        );
        sendJson(res, 200, {
          url: result.readUrl,
          objectKey: result.objectKey,
          contentType: result.contentType,
          userId,
          assetType,
          category,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : '上传失败';
        console.error('[upload-asset]', message);
        sendJson(res, 500, { error: message });
      }
      resolve();
    });
  });
}

export function createUploadAssetMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/api/upload-asset')) {
      next();
      return;
    }
    void process(req, res);
  };
}

/** Vercel / 独立 Node 处理器 */
export async function handleUploadAssetRequest(
  req: IncomingMessage & { method?: string },
  res: ServerResponse
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  await process(req, res);
}
