import { TSESLint } from '@typescript-eslint/utils';

const rule: TSESLint.RuleModule<'restricted', []> = {
  meta: {
    type: 'problem',
    messages: {
      restricted: 'Cross-service imports are not allowed',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node: any) {
        if (node.source.value.includes('/services/')) {
          context.report({ node, messageId: 'restricted' });
        }
      },
    };
  },
};

export default rule;