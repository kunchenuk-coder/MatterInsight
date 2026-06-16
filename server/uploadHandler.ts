import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { uploadToObjectStorage } from './objectStorage';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

type MulterRequest = IncomingMessage & {
  file?: Express.Multer.File;
};

const ALLOWED_FOLDERS = new Set([
  'materials',
  'variants',
  'project-photos',
  'verification',
  'local-materials',
]);

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function verifyAuthToken(
  authHeader: string | undefined
): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (!url || !serviceKey) return null;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export function createUploadMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/api/upload')) {
      next();
      return;
    }

    // multer 类型与 Node IncomingMessage 不完全兼容，运行时正常
    upload.single('file')(req as never, res as never, async (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : '文件解析失败';
        sendJson(res, 400, { error: msg });
        return;
      }

      const mreq = req as MulterRequest;
      const userId = await verifyAuthToken(req.headers.authorization);
      if (!userId) {
        sendJson(res, 401, { error: '未登录或 token 无效' });
        return;
      }

      if (!mreq.file) {
        sendJson(res, 400, { error: '未收到文件' });
        return;
      }

      const mime = mreq.file.mimetype;
      if (!mime.startsWith('image/')) {
        sendJson(res, 400, { error: '仅支持图片文件' });
        return;
      }

      const urlObj = new URL(req.url ?? '/', 'http://localhost');
      const folderParam = urlObj.searchParams.get('folder') ?? 'materials';
      const folder = ALLOWED_FOLDERS.has(folderParam) ? folderParam : 'materials';

      try {
        const publicUrl = await uploadToObjectStorage(
          mreq.file.buffer,
          `${folder}/${userId}`,
          mreq.file.originalname,
          mime
        );
        sendJson(res, 200, { url: publicUrl, userId });
      } catch (e) {
        const message = e instanceof Error ? e.message : '上传失败';
        console.error('[upload]', message);
        sendJson(res, 500, { error: message });
      }
    });
  };
}

/** Vercel / 独立 Node 处理器 */
export async function handleUploadRequest(
  req: IncomingMessage & { method?: string },
  res: ServerResponse
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  return new Promise((resolve) => {
    // multer 类型与 Node IncomingMessage 不完全兼容，运行时正常
    upload.single('file')(req as never, res as never, async (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : '文件解析失败';
        sendJson(res, 400, { error: msg });
        resolve();
        return;
      }

      const mreq = req as MulterRequest;
      const userId = await verifyAuthToken(req.headers.authorization);
      if (!userId) {
        sendJson(res, 401, { error: '未登录或 token 无效' });
        resolve();
        return;
      }

      if (!mreq.file) {
        sendJson(res, 400, { error: '未收到文件' });
        resolve();
        return;
      }

      const mime = mreq.file.mimetype;
      if (!mime.startsWith('image/')) {
        sendJson(res, 400, { error: '仅支持图片文件' });
        resolve();
        return;
      }

      const folder = 'materials';

      try {
        const urlObj = new URL((req as IncomingMessage).url ?? '/', 'http://localhost');
        const folderParam = urlObj.searchParams.get('folder') ?? 'materials';
        const safeFolder = ALLOWED_FOLDERS.has(folderParam) ? folderParam : folder;

        const publicUrl = await uploadToObjectStorage(
          mreq.file.buffer,
          `${safeFolder}/${userId}`,
          mreq.file.originalname,
          mime
        );
        sendJson(res, 200, { url: publicUrl, userId });
      } catch (e) {
        const message = e instanceof Error ? e.message : '上传失败';
        sendJson(res, 500, { error: message });
      }
      resolve();
    });
  });
}
