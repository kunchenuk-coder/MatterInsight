export const config = {
  api: {
    bodyParser: false,
  },
};

import { handleUploadAssetRequest } from '../server/uploadAssetHandler';

export default async function handler(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse
) {
  await handleUploadAssetRequest(req, res);
}
