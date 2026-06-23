
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      violation: 'Cross-service imports are forbidden.',
    },
  },
  create(context: any) {
    return {};
  },
};
