'use strict';



const PUBLIC_EXTENSIONS = [
  '.js',
  '.mjs',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.html',
  '.json',
  '.map',
  '.txt',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.wasm'
];
const USERS = {
  admin: 'Myvital@2026',
  dev: 'Myvital@2026'
};
exports.handler = async (event) => {
  const request = event.Records[0].cf.request;

  const uri = (request.uri || '').toLowerCase();

  // Allow HEAD requests
  if (request.method === 'HEAD') {
    return request;
  }

  // Allow static assets
  const isStaticAsset =
    uri.startsWith('/assets/') ||
    uri.startsWith('/static/') ||
    uri === '/favicon.ico' ||
    uri.includes('.') ||
    PUBLIC_EXTENSIONS.some((ext) => uri.endsWith(ext));

  if (isStaticAsset) {
    return request;
  }

  const headers = request.headers;

  const authHeader =
    headers.authorization?.[0]?.value ||
    headers.Authorization?.[0]?.value;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return unauthorized();
  }

  let decoded;

  try {
    const encoded = authHeader.split(' ')[1];
    decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  } catch (err) {
    return unauthorized();
  }

  const separatorIndex = decoded.indexOf(':');

  if (separatorIndex === -1) {
    return unauthorized();
  }

  const username = decoded.substring(0, separatorIndex);
  const password = decoded.substring(separatorIndex + 1);

  if (USERS[username] !== password) {
    return unauthorized();
  }

  return request;
};

function unauthorized() {
  return {
    status: '401',
    statusDescription: 'Unauthorized',
    headers: {
      'www-authenticate': [
        {
          key: 'WWW-Authenticate',
          value: 'Basic realm="Secure Area"'
        }
      ],
      'cache-control': [
        {
          key: 'Cache-Control',
          value: 'no-store'
        }
      ],
      pragma: [
        {
          key: 'Pragma',
          value: 'no-cache'
        }
      ]
    }
  };
}