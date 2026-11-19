'use strict';

/**
 * Extends serverless-plugin-split-stacks beyond default perType.
 *
 * Default perType nests ApiGateway::Resource and Lambda::Permission, but NOT
 * ApiGateway::Method or Logs::LogGroup. Moving methods into the API nested
 * stack creates a parent/child dependency cycle for Lambda authorizers:
 *
 *   parent Authorizer -> API nested stack (for RestApiId)
 *   API nested stack -> parent Authorizer (for protected methods)
 *
 * Keep methods in the parent stack. With the generated LogGroups stripped,
 * this service remains below CloudFormation's 500-resource limit.
 *
 * Do NOT use `force: true` for Method / GatewayResponse / Permission on an
 * already-deployed stage. Those types have unique physical identities
 * (apiId|resourceId|httpMethod, response type, or Lambda statement id).
 * CloudFormation updates nested stacks before deleting from the parent, so
 * force-migration fails with "already exists in stack …/vendor-service-api-dev".
 *
 * Without force:
 * - Existing resources stay in the root stack (safe).
 * - Gateway responses and permissions go to nested stacks (headroom).
 */
module.exports = {
  'AWS::ApiGateway::GatewayResponse': {
    destination: 'API',
  },
  'AWS::Lambda::Permission': {
    destination: 'Permissions',
  },
};
