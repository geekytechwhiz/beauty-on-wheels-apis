import { TSESLint } from '@typescript-eslint/utils';

const rule: TSESLint.RuleModule<'missingKey', []> = {
  meta: {
    type: 'problem',
    messages: {
      missingKey: 'Missing idempotencyKey in event publish',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node: any) {
        if (node.callee?.property?.name === 'publish') {
          const arg = node.arguments[0];
          if (!arg || arg.type !== 'ObjectExpression') return;

          const hasKey = arg.properties.some(
            (p: any) => p.key?.name === 'idempotencyKey'
          );

          if (!hasKey) {
            context.report({ node, messageId: 'missingKey' });
          }
        }
      },
    };
  },
};

export default rule;