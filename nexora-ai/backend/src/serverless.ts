import 'reflect-metadata';
import { createNexoraApp } from './main';

let cachedExpressInstance: any = null;
let initPromise: Promise<any> | null = null;

async function getServerInstance() {
  if (cachedExpressInstance) {
    return cachedExpressInstance;
  }
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const app = await createNexoraApp();
        await app.init();
        cachedExpressInstance = app.getHttpAdapter().getInstance();
        return cachedExpressInstance;
      } catch (err) {
        initPromise = null;
        throw err;
      }
    })();
  }
  return initPromise;
}

export default async function handler(req: any, res: any) {
  const server = await getServerInstance();
  return server(req, res);
}

module.exports = handler;
module.exports.default = handler;
