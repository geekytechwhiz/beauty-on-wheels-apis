import type { TSESLint } from '@typescript-eslint/utils';

import noDirectDynamoDb from './rules/no-direct-dynamodb';
import noProcessEnvOutsideConfig from './rules/no-process-env-outside-config';
import noControllerBusinessLogic from './rules/no-controller-business-logic';
import enforcePlatformLogger from './rules/enforce-platform-logger';
import noHardcodedAwsResource from './rules/no-hardcoded-aws-resource';

const plugin: TSESLint.FlatConfig.Plugin = {
  meta: {
    name: '@api-hub/eslint-plugin-mvrx',
    version: '1.0.0',
  },

  rules: {
    'no-direct-dynamodb': noDirectDynamoDb,
    'no-process-env-outside-config': noProcessEnvOutsideConfig,
    'no-controller-business-logic': noControllerBusinessLogic,
    'enforce-platform-logger': enforcePlatformLogger,
    'no-hardcoded-aws-resource': noHardcodedAwsResource,
  },
};

export default plugin;
