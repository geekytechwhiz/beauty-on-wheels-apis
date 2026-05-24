import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { S3SpecStore } from '../server/s3-spec-store';
import { assertS3Configured } from '../server/s3.service';
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

type SpecStore = LocalSpecStore | S3SpecStore;

export function localSpecApiPlugin(options: {
  enabled: boolean;
  specsPrefix?: string;
  useS3?: boolean;
}): Plugin {
  const specsPrefix = (options.specsPrefix || 'specs-store').replace(/^\/+|\/+$/g, '');
  const specsDir = process.env.API_CENTER_SPECS_DIR;
  const useS3 = options.useS3 === true;

  let store: SpecStore | null = null;

  function ensureStore(rootDir: string): SpecStore {
    if (!store) {
      if (useS3) {
        assertS3Configured();
        store = new S3SpecStore();
      } else {
        store = new LocalSpecStore({
          rootDir,
          specsDir,
          prefix: specsPrefix,
        });
      }
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
            const catalog =
              activeStore instanceof S3SpecStore
                ? await activeStore.getCatalog()
                : activeStore.getCatalog();
            sendJson(res, 200, catalog);
            return;
          }

          if (req.method === 'GET' && pathname === '/document') {
            const reqUrl = new URL(req.url ?? '', 'http://localhost');
            const serviceName = reqUrl.searchParams.get('serviceName') ?? '';
            const version = reqUrl.searchParams.get('version') ?? '';
            const spec =
              activeStore instanceof S3SpecStore
                ? await activeStore.readSpecText(serviceName, version)
                : activeStore.readSpecText(serviceName, version);
            sendJson(res, 200, spec);
            return;
          }

          if (req.method === 'GET' && pathname === '/presigned-download') {
            if (!(activeStore instanceof S3SpecStore)) {
              sendError(res, 400, 'Presigned download requires S3 spec store mode.');
              return;
            }
            const reqUrl = new URL(req.url ?? '', 'http://localhost');
            const serviceName = reqUrl.searchParams.get('serviceName') ?? '';
            const version = reqUrl.searchParams.get('version') ?? '';
            const result = await activeStore.createPresignedDownload(serviceName, version);
            sendJson(res, 200, result);
            return;
          }

          if (req.method === 'POST' && pathname === '/presigned-upload') {
            if (!(activeStore instanceof S3SpecStore)) {
              sendError(res, 400, 'Presigned upload requires S3 spec store mode.');
              return;
            }
            const raw = await readBody(req);
            const body = JSON.parse(raw) as {
              serviceName?: string;
              version?: string;
              fileName?: string;
            };
            if (!body.fileName) {
              sendError(res, 400, 'fileName is required.');
              return;
            }
            const result = await activeStore.createPresignedUpload({
              serviceName: body.serviceName ?? '',
              version: body.version ?? '',
              fileName: body.fileName,
            });
            sendJson(res, 200, result);
            return;
          }

          if (req.method === 'POST' && pathname === '/upload-complete') {
            if (!(activeStore instanceof S3SpecStore)) {
              sendError(res, 400, 'Upload complete requires S3 spec store mode.');
              return;
            }
            const raw = await readBody(req);
            const body = JSON.parse(raw) as {
              serviceName?: string;
              version?: string;
              fileName?: string;
              key?: string;
            };
            if (!body.fileName || !body.key) {
              sendError(res, 400, 'fileName and key are required.');
              return;
            }
            const created = await activeStore.completeUpload({
              serviceName: body.serviceName ?? '',
              version: body.version ?? '',
              fileName: body.fileName,
              key: body.key,
            });
            sendJson(res, 200, created);
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
            const uploaded =
              activeStore instanceof S3SpecStore
                ? await activeStore.upload({
                    serviceName: body.serviceName ?? '',
                    version: body.version ?? '',
                    fileName: body.fileName,
                    contentBase64: body.contentBase64,
                  })
                : activeStore.upload({
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
            if (activeStore instanceof S3SpecStore) {
              await activeStore.deleteVersion({
                serviceName: body.serviceName ?? '',
                version: body.version ?? '',
              });
            } else {
              activeStore.deleteVersion({
                serviceName: body.serviceName ?? '',
                version: body.version ?? '',
              });
            }
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
            const saved =
              activeStore instanceof S3SpecStore
                ? await activeStore.saveEdited({
                    serviceName: body.serviceName ?? '',
                    version: body.version ?? '',
                    yamlText: body.yamlText,
                  })
                : activeStore.saveEdited({
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
            const updated =
              activeStore instanceof S3SpecStore
                ? await activeStore.updateStatus({
                    serviceName: body.serviceName ?? '',
                    version: body.version ?? '',
                    status,
                  })
                : activeStore.updateStatus({
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
      server.middlewares.use(attachHandler(server.config.root));
    },
  };
}
