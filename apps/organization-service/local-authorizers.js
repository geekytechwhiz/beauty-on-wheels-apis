const AWS = require('aws-sdk');

const FUNCTION_NAME =
  process.env.LOCAL_COMMON_AUTHORIZER_FUNCTION_NAME || 'common-backend-authorizer-local-dev-common_authorizer';
const LAMBDA_ENDPOINT =
  process.env.LOCAL_COMMON_AUTHORIZER_LAMBDA_ENDPOINT || 'http://localhost:4002';
const REGION = process.env.LOCAL_COMMON_AUTHORIZER_REGION || process.env.AWS_REGION || 'us-east-1';

const lambda = new AWS.Lambda({
  region: REGION,
  endpoint: LAMBDA_ENDPOINT,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'offline',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'offline',
});

async function localCommonAuthorizer(event) {
  const result = await lambda
    .invoke({
      FunctionName: FUNCTION_NAME,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(event || {}),
    })
    .promise();

  return JSON.parse(result.Payload || '{}');
}

module.exports = { localCommonAuthorizer };
