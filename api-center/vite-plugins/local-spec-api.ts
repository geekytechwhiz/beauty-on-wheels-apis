import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  LocalSpecStore,
  type SpecReviewStatus,
} from './spec-store';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

export function localSpecApiPlugin(options: { enabled: boolean; specsPrefix?: string }): Plugin {
  const specsPrefix = (options.specsPrefix || 'specs-store').replace(/^\/+|\/+$/g, '');
  const specsDir = process.env.API_CENTER_SPECS_DIR;

  let store: LocalSpecStore | null = null;

  function ensureStore(rootDir: string): LocalSpecStore {
    if (!store) {
      store = new LocalSpecStore({
        rootDir,
        specsDir,
        prefix: specsPrefix,
      });
    }
    return store;
  }

  function attachHandler(rootDir: string) {
    return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const url = req.url?.split('?')[0] ?? '';
      if (!url.startsWith('/__api-center/specs-store')) {
        next();
        return;
      }

      void (async () => {
        try {
          const pathname = url.replace('/__api-center/specs-store', '') || '/';
          const activeStore = ensureStore(rootDir);

          if (req.method === 'GET' && pathname === '/catalog') {
            sendJson(res, 200, activeStore.getCatalog());
            return;
          }

          if (req.method === 'GET' && pathname === '/document') {
            const reqUrl = new URL(req.url ?? '', 'http://localhost');
            const serviceName = reqUrl.searchParams.get('serviceName') ?? '';
            const version = reqUrl.searchParams.get('version') ?? '';
            const spec = activeStore.readSpecText(serviceName, version);
            sendJson(res, 200, spec);
            return;
          }

          if (req.method === 'POST' && pathname === '/upload') {
            const raw = await readBody(req);
            const body = JSON.parse(raw) as {
              serviceName?: string;
              version?: string;
              fileName?: string;
              contentBase64?: string;
            };
            if (!body.fileName || !body.contentBase64) {
              sendError(res, 400, 'fileName and contentBase64 are required.');
              return;
            }
            const uploaded = activeStore.upload({
              serviceName: body.serviceName ?? '',
              version: body.version ?? '',
              fileName: body.fileName,
              contentBase64: body.contentBase64,
            });
            sendJson(res, 200, uploaded);
            return;
          }

          if (req.method === 'POST' && pathname === '/delete') {
            const raw = await readBody(req);
            const body = JSON.parse(raw) as {
              serviceName?: string;
              version?: string;
            };
            activeStore.deleteVersion({
              serviceName: body.serviceName ?? '',
              version: body.version ?? '',
            });
            sendJson(res, 200, { ok: true });
            return;
          }

          if (req.method === 'POST' && pathname === '/save-edited') {
            const raw = await readBody(req);
            const body = JSON.parse(raw) as {
              serviceName?: string;
              version?: string;
              yamlText?: string;
            };
            if (typeof body.yamlText !== 'string') {
              sendError(res, 400, 'yamlText is required.');
              return;
            }
            const saved = activeStore.saveEdited({
              serviceName: body.serviceName ?? '',
              version: body.version ?? '',
              yamlText: body.yamlText,
            });
            sendJson(res, 200, saved);
            return;
          }

          if (req.method === 'PATCH' && pathname === '/status') {
            const raw = await readBody(req);
            const body = JSON.parse(raw) as {
              serviceName?: string;
              version?: string;
              status?: SpecReviewStatus;
            };
            const status = body.status;
            if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
              sendError(res, 400, 'status must be pending, approved, or rejected.');
              return;
            }
            const updated = activeStore.updateStatus({
              serviceName: body.serviceName ?? '',
              version: body.version ?? '',
              status,
            });
            sendJson(res, 200, updated);
            return;
          }

          sendError(res, 404, 'Not found.');
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Request failed.';
          sendError(res, 400, message);
        }
      })();
    };
  }

  return {
    name: 'local-spec-api',
    configureServer(server) {
      if (!options.enabled) {
        return;
      }
      server.middlewares.use(attachHandler(server.config.root));
    },
    configurePreviewServer(server) {
      if (!options.enabled) {
        return;
      }
      server.middlewares.use(attachHandler(process.cwd()));
    },
  };
}
