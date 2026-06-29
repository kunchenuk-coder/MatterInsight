export const config = {
  api: {
    bodyParser: false,
  },
};

import { handleGetReadUrlRequest } from '../server/getReadUrlHandler';

export default async function handler(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse
) {
  await handleGetReadUrlRequest(req, res);
}
