import { TSESTree } from '@typescript-eslint/utils';

const AWS_RESOURCE_PROPERTIES = [
  'TableName',
  'Bucket',
  'BucketName',
  'QueueName',
  'QueueUrl',
  'TopicArn',
  'FunctionName',
  'EventBusName',
];

const ARN_REGEX = /^arn:aws:/;
const ACCOUNT_ID_REGEX = /\b\d{12}\b/;
const REGION_REGEX = /\b(ap|us|eu|ca|sa|af|me)-[a-z]+-\d\b/;
const API_GATEWAY_REGEX = /execute-api/;
const CLOUDFRONT_REGEX = /cloudfront\.net/;

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      hardcodedResource:
        'Hardcoded AWS resource detected. Use config or environment variables.',

      hardcodedArn: 'Hardcoded AWS ARN detected.',

      hardcodedRegion: 'Hardcoded AWS region detected.',

      hardcodedAccount: 'Hardcoded AWS account ID detected.',
    },
  },

  create(context: any) {
    return {
      Literal(node: TSESTree.Literal) {
        if (typeof node.value !== 'string') {
          return;
        }

        const value = node.value;

        if (ARN_REGEX.test(value)) {
          context.report({
            node,
            messageId: 'hardcodedArn',
          });
        }

        if (ACCOUNT_ID_REGEX.test(value)) {
          context.report({
            node,
            messageId: 'hardcodedAccount',
          });
        }

        if (REGION_REGEX.test(value)) {
          context.report({
            node,
            messageId: 'hardcodedRegion',
          });
        }

        if (API_GATEWAY_REGEX.test(value) || CLOUDFRONT_REGEX.test(value)) {
          context.report({
            node,
            messageId: 'hardcodedResource',
          });
        }
      },

      Property(node: TSESTree.Property) {
        if (
          node.key.type !== 'Identifier' ||
          !AWS_RESOURCE_PROPERTIES.includes(node.key.name)
        ) {
          return;
        }

        if (
          node.value.type === 'Literal' &&
          typeof node.value.value === 'string'
        ) {
          context.report({
            node,
            messageId: 'hardcodedResource',
          });
        }
      },
    };
  },
};
