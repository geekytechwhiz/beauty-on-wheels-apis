
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      violation: 'Avoid shared mutable state across services.',
    },
  },
  create(context: any) {
    return {};
  },
};
