import { TSESTree } from '@typescript-eslint/utils';

const REPOSITORY_PATTERNS = ['repository', 'repo'];

const BUSINESS_FUNCTION_PATTERNS = [
  'calculate',
  'compute',
  'process',
  'generate',
  'evaluate',
  'determine',
  'score',
];

const HTTP_CLIENTS = ['axios', 'fetch'];

const AWS_CLIENTS = [
  'DynamoDBClient',
  'DynamoDBDocumentClient',
  'S3Client',
  'SNSClient',
  'SQSClient',
  'EventBridgeClient',
];

function isControllerFile(filename: string): boolean {
  const lower = filename.toLowerCase();

  return lower.includes('controller') || lower.includes('handler');
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Controllers should not contain business logic.',
    },
    schema: [],
    messages: {
      repositoryAccess:
        'Controllers must not access repositories directly. Use a service layer.',

      businessLogic:
        'Business logic detected inside controller. Move logic to service layer.',

      awsAccess: 'Controllers must not access AWS SDK directly.',

      externalCall:
        'Controllers must not call external APIs directly. Use a service layer.',

      loopLogic:
        'Complex processing detected. Move business logic to service layer.',
    },
  },

  create(context: any) {
    const filename = context.filename || context.getFilename();

    if (!isControllerFile(filename)) {
      return {};
    }

    return {
      /**
       * Repository calls
       */
      MemberExpression(node: TSESTree.MemberExpression) {
        if (node.property.type === 'Identifier') {
          const name = node.property.name.toLowerCase();

          if (REPOSITORY_PATTERNS.some((pattern) => name.includes(pattern))) {
            context.report({
              node,
              messageId: 'repositoryAccess',
            });
          }
        }
      },

      /**
       * Business function calls
       */
      CallExpression(node: TSESTree.CallExpression) {
        const callee = node.callee;

        /**
         * calculateRisk()
         * processPatient()
         */
        if (callee.type === 'Identifier') {
          const name = callee.name.toLowerCase();

          if (
            BUSINESS_FUNCTION_PATTERNS.some((pattern) => name.includes(pattern))
          ) {
            context.report({
              node,
              messageId: 'businessLogic',
            });
          }

          if (HTTP_CLIENTS.includes(callee.name)) {
            context.report({
              node,
              messageId: 'externalCall',
            });
          }
        }

        /**
         * axios.post()
         * repository.save()
         * dynamodb.send()
         */
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier'
        ) {
          const objectName = callee.object.name.toLowerCase();

          if (
            objectName.includes('repository') ||
            objectName.includes('repo')
          ) {
            context.report({
              node,
              messageId: 'repositoryAccess',
            });
          }

          if (
            objectName.includes('dynamodb') ||
            objectName.includes('s3') ||
            objectName.includes('sns') ||
            objectName.includes('sqs')
          ) {
            context.report({
              node,
              messageId: 'awsAccess',
            });
          }

          if (HTTP_CLIENTS.includes(objectName)) {
            context.report({
              node,
              messageId: 'externalCall',
            });
          }
        }
      },

      /**
       * new DynamoDBClient()
       */
      NewExpression(node: TSESTree.NewExpression) {
        if (
          node.callee.type === 'Identifier' &&
          AWS_CLIENTS.includes(node.callee.name)
        ) {
          context.report({
            node,
            messageId: 'awsAccess',
          });
        }
      },

      /**
       * for (...)
       */
      ForStatement(node: TSESTree.ForStatement) {
        context.report({
          node,
          messageId: 'loopLogic',
        });
      },

      /**
       * for of (...)
       */
      ForOfStatement(node: TSESTree.ForOfStatement) {
        context.report({
          node,
          messageId: 'loopLogic',
        });
      },

      /**
       * while (...)
       */
      WhileStatement(node: TSESTree.WhileStatement) {
        context.report({
          node,
          messageId: 'loopLogic',
        });
      },
    };
  },
};
