
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      violation: 'AWS SDK usage is not allowed in controllers.',
    },
  },
  create(context: any) {
    return {};
  },
};
