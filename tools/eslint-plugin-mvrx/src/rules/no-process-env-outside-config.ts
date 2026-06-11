import { TSESTree } from '@typescript-eslint/utils';

const ALLOWED_PATHS = [
  '/config/',
  '/configuration/',
  '/env/',
  '/settings/',
  '.config.ts',
  '.env.ts',
  '.configuration.ts',
  '.settings.ts',
];

function isAllowedFile(filename: string): boolean {
  return ALLOWED_PATHS.some((path) => filename.includes(path));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent process.env usage outside configuration layer',
    },
    schema: [],
    messages: {
      processEnvUsage:
        'Do not access process.env directly. Use the central config module instead.',
    },
  },

  create(context: any) {
    const filename = context.filename || context.getFilename();

    const allowed = isAllowedFile(filename);

    return {
      MemberExpression(node: TSESTree.MemberExpression) {
        if (allowed) {
          return;
        }

        /**
         * process.env
         */
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'process' &&
          node.property.type === 'Identifier' &&
          node.property.name === 'env'
        ) {
          context.report({
            node,
            messageId: 'processEnvUsage',
          });
        }
      },
    };
  },
};
