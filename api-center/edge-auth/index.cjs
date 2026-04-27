'use strict';

const USERS = {
  admin: 'Myvital@2026',
  dev: 'Myvital@2026'
};

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;

  const headers = request.headers;
  const authHeader = headers.authorization?.[0]?.value;

  // 🔓 Allow static assets (prevents weird browser behavior)
  if (
    request.uri.includes('.js') ||
    request.uri.includes('.css') ||
    request.uri.includes('.png') ||
    request.uri.includes('.svg') ||
    request.uri.includes('.ico')
  ) {
    return request;
  }

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return unauthorized();
  }

  const encoded = authHeader.split(' ')[1];
  const decoded = Buffer.from(encoded, 'base64').toString();

  const [username, password] = decoded.split(':');

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
      ]
    }
  };
}