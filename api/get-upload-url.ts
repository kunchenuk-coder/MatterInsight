export const config = {
  api: {
    bodyParser: false,
  },
};

import { handleGetUploadUrlRequest } from '../server/getUploadUrlHandler';

export default async function handler(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse
) {
  await handleGetUploadUrlRequest(req, res);
}
