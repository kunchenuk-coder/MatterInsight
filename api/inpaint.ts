export const config = {
  api: {
    bodyParser: false,
  },
};

import { handleInpaintRequest } from "../server/inpaintHandler.js";

export default async function handler(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse
) {
  await handleInpaintRequest(req, res);
}
