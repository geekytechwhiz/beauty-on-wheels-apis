import { TSESLint } from '@typescript-eslint/utils';

const rule: TSESLint.RuleModule<'deepImport', []> = {
  meta: {
    type: 'suggestion',
    messages: {
      deepImport: 'Avoid deep relative imports',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node: any) {
        if (node.source.value.includes('../../')) {
          context.report({ node, messageId: 'deepImport' });
        }
      },
    };
  },
};

export default rule;