import { TSESTree } from '@typescript-eslint/utils';

const ALLOWED_LOGGER_NAMES = ['logger', 'platformLogger', 'appLogger'];

const ALLOWED_LOGGER_METHODS = ['info', 'error', 'warn', 'debug', 'trace'];

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce usage of platform logger instead of console statements',
    },
    schema: [],
    messages: {
      noConsole:
        'Do not use console statements. Use the platform logger instead.',

      invalidLogger: 'Use the approved platform logger implementation.',

      invalidLoggerMethod:
        'Use a supported logger method (info, error, warn, debug, trace).',
    },
  },

  create(context: any) {
    const loggerVariables = new Set<string>();

    return {
      /**
       * import { logger } from ...
       * import { platformLogger } from ...
       */
      ImportSpecifier(node: TSESTree.ImportSpecifier) {
        const imported = node.imported;

        if (
          imported.type === 'Identifier' &&
          ALLOWED_LOGGER_NAMES.includes(imported.name)
        ) {
          loggerVariables.add(node.local.name);
        }
      },

      /**
       * const logger = createLogger(...)
       */
      VariableDeclarator(node: TSESTree.VariableDeclarator) {
        if (
          node.id.type === 'Identifier' &&
          ALLOWED_LOGGER_NAMES.includes(node.id.name)
        ) {
          loggerVariables.add(node.id.name);
        }
      },

      /**
       * console.log()
       * console.error()
       */
      CallExpression(node: TSESTree.CallExpression) {
        const callee = node.callee;

        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'console'
        ) {
          context.report({
            node,
            messageId: 'noConsole',
          });

          return;
        }

        /**
         * logger.xxx()
         */
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier'
        ) {
          const loggerName = callee.object.name;

          if (!loggerVariables.has(loggerName)) {
            return;
          }

          if (
            callee.property.type === 'Identifier' &&
            !ALLOWED_LOGGER_METHODS.includes(callee.property.name)
          ) {
            context.report({
              node,
              messageId: 'invalidLoggerMethod',
            });
          }
        }
      },
    };
  },
};
