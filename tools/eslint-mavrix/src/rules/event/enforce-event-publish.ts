import { TSESLint } from '@typescript-eslint/utils';

const rule: TSESLint.RuleModule<'invalidPublish', []> = {
  meta: {
    type: 'problem',
    messages: {
      invalidPublish: 'Use eventBus.publish instead of direct broker usage',
    },
    schema: [],
  },
  create(context: TSESLint.RuleContext<string, any[]>) {
    return {
      CallExpression(node: any) {
        if (
          node.callee?.property?.name === 'send' ||
          node.callee?.property?.name === 'emit'
        ) {
          context.report({ node, messageId: 'invalidPublish' });
        }
      },
    };
  },
};

export default rule;