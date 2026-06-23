
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      violation: 'Async operations must have error handling.',
    },
  },
  create(context: any) {
    return {};
  },
};
