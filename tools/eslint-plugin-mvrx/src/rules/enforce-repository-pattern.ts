
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      violation: 'Database access must go through repositories.',
    },
  },
  create(context: any) {
    return {};
  },
};
