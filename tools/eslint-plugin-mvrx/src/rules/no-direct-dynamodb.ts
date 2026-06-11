import { TSESTree } from '@typescript-eslint/utils';

const ALLOWED_PATHS = [
  '/repository/',
  '/repositories/',
  '/data-access/',
  '.repository.ts',
];

const DYNAMODB_PACKAGES = ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'];

const DYNAMODB_CLIENTS = ['DynamoDBClient', 'DynamoDBDocumentClient'];

const DYNAMODB_COMMANDS = [
  'GetCommand',
  'PutCommand',
  'UpdateCommand',
  'DeleteCommand',
  'QueryCommand',
  'ScanCommand',
  'BatchGetCommand',
  'BatchWriteCommand',
  'TransactWriteCommand',
  'TransactGetCommand',
];

const DYNAMODB_UTILS = ['marshall', 'unmarshall'];

function isAllowedFile(filename: string): boolean {
  return ALLOWED_PATHS.some((path) => filename.includes(path));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prevent direct DynamoDB usage outside repository/data-access layer',
    },
    schema: [],
    messages: {
      directImport:
        'DynamoDB imports are allowed only inside repository/data-access layers.',

      directClient:
        'DynamoDB clients are allowed only inside repository/data-access layers.',

      directCommand:
        'DynamoDB commands are allowed only inside repository/data-access layers.',

      directSend:
        'Direct DynamoDB access detected. Use repository abstraction.',

      directMarshall:
        'marshall/unmarshall should only be used inside repositories.',

      scanDetected: 'Avoid ScanCommand. Use QueryCommand and indexes instead.',
    },
  },

  create(context: any) {
    const filename = context.filename || context.getFilename();

    const allowed = isAllowedFile(filename);

    return {
      /**
       * import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
       */
      ImportDeclaration(node: TSESTree.ImportDeclaration) {
        if (allowed) return;

        const source = String(node.source.value);

        if (DYNAMODB_PACKAGES.includes(source)) {
          context.report({
            node,
            messageId: 'directImport',
          });
        }
      },

      /**
       * new DynamoDBClient()
       * new PutCommand()
       */
      NewExpression(node: TSESTree.NewExpression) {
        const callee = node.callee;

        if (callee.type === 'Identifier' && callee.name === 'ScanCommand') {
          context.report({
            node,
            messageId: 'scanDetected',
          });

          return;
        }

        if (allowed) return;

        if (
          callee.type === 'Identifier' &&
          DYNAMODB_CLIENTS.includes(callee.name)
        ) {
          context.report({
            node,
            messageId: 'directClient',
          });

          return;
        }

        if (
          callee.type === 'Identifier' &&
          DYNAMODB_COMMANDS.includes(callee.name)
        ) {
          context.report({
            node,
            messageId: 'directCommand',
          });
        }
      },

      /**
       * DynamoDBDocumentClient.from(...)
       * marshall(...)
       * unmarshall(...)
       * client.send(...)
       */
      CallExpression(node: TSESTree.CallExpression) {
        const callee = node.callee;

        // Block ScanCommand even in repositories
        if (callee.type === 'Identifier' && callee.name === 'ScanCommand') {
          context.report({
            node,
            messageId: 'scanDetected',
          });

          return;
        }

        if (allowed) return;

        /**
         * marshall(...)
         * unmarshall(...)
         */
        if (
          callee.type === 'Identifier' &&
          DYNAMODB_UTILS.includes(callee.name)
        ) {
          context.report({
            node,
            messageId: 'directMarshall',
          });

          return;
        }

        /**
         * DynamoDBDocumentClient.from(...)
         */
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'DynamoDBDocumentClient' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'from'
        ) {
          context.report({
            node,
            messageId: 'directClient',
          });

          return;
        }

        /**
         * client.send(...)
         * docClient.send(...)
         */
        if (
          callee.type === 'MemberExpression' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'send'
        ) {
          context.report({
            node,
            messageId: 'directSend',
          });
        }
      },
    };
  },
};
