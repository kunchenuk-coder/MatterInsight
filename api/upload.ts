export const config = {
  api: {
    bodyParser: false,
  },
};

import { handleUploadRequest } from '../server/uploadHandler';

export default async function handler(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  await handleUploadRequest(req, res);
}
