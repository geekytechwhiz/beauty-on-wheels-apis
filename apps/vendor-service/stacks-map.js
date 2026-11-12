'use strict';

/**
 * Extends serverless-plugin-split-stacks beyond default perType.
 *
 * Default perType nests ApiGateway::Resource and Lambda::Permission, but NOT
 * ApiGateway::Method or Logs::LogGroup. Methods therefore accumulate in the
 * root stack and trip CloudFormation's 500-resource limit.
 *
 * Do NOT use `force: true` for Method / GatewayResponse / Permission on an
 * already-deployed stage. Those types have unique physical identities
 * (apiId|resourceId|httpMethod, response type, or Lambda statement id).
 * CloudFormation updates nested stacks before deleting from the parent, so
 * force-migration fails with "already exists in stack …/vendor-service-api-dev".
 *
 * Without force:
 * - Existing resources stay in the root stack (safe).
 * - Newly added resources of these types go to the nested stacks (headroom).
 */
module.exports = {
  'AWS::ApiGateway::Method': {
    destination: 'API',
  },
  'AWS::ApiGateway::GatewayResponse': {
    destination: 'API',
  },
  'AWS::Lambda::Permission': {
    destination: 'Permissions',
  },
};
