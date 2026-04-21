'use strict';

const REALM = 'Developer Portal';

// Lambda@Edge does not support environment variables.
// Keep this list short-lived and rotate credentials regularly.
const USERS = {
  devuser: 'devpassword',
  prasanth: 'secure123',
  dev: 'dev123',
};

function unauthorized() {
  return {
    status: '401',
    statusDescription: 'Unauthorized',
    headers: {
      'www-authenticate': [
        {
          key: 'WWW-Authenticate',
          value: `Basic realm="${REALM}"`,
        },
      ],
    },
  };
}

function isAuthorized(authHeaderValue) {
  if (!authHeaderValue || !authHeaderValue.startsWith('Basic ')) {
    return false;
  }

  const encoded = authHeaderValue.slice('Basic '.length).trim();
  if (!encoded) {
    return false;
  }

  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) {
    return false;
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  return Boolean(USERS[username] && USERS[username] === password);
}

exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const authHeader = request.headers.authorization?.[0]?.value;

  if (!isAuthorized(authHeader)) {
    return unauthorized();
  }

  return request;
};
