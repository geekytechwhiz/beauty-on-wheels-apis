import { TSESLint } from '@typescript-eslint/utils';

const regex = /^[a-z]+(\.[a-z]+){2,}$/;

const rule: TSESLint.RuleModule<'invalid', []> = {
  meta: {
    type: 'problem',
    messages: {
      invalid: 'Event name must follow domain.entity.action format',
    },
    schema: [],
  },
  create(context) {
    return {
      Literal(node: any) {
        if (typeof node.value === 'string' && node.value.includes('.')) {
          if (!regex.test(node.value)) {
            context.report({ node, messageId: 'invalid' });
          }
        }
      },
    };
  },
};

export default rule;