'use strict';

const USERS = {
  admin: 'Myvital@2026',
  dev: 'Myvital@2026'
};

const PUBLIC_EXTENSIONS = [
  '.js', '.mjs', '.css', '.png', '.svg', '.ico',
  '.html', '.json', '.map', '.woff', '.woff2', '.wasm'
];

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const headers = request.headers;

  const authHeader =
    headers.authorization?.[0]?.value ||
    headers.Authorization?.[0]?.value;

  // Allow HEAD requests
  if (request.method === 'HEAD') {
    return request;
  }

  // Allow static assets safely
  const isStatic = PUBLIC_EXTENSIONS.some(ext =>
    request.uri.toLowerCase().endsWith(ext)
  );

  if (isStatic) {
    return request;
  }

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return unauthorized();
  }

  const encoded = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString();
  } catch (e) {
    return unauthorized();
  }

  const index = decoded.indexOf(':');
  if (index === -1) return unauthorized();

  const username = decoded.substring(0, index);
  const password = decoded.substring(index + 1);

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
      'pragma': [
        {
          key: 'Pragma',
          value: 'no-cache'
        }
      ]
    }
  };
}