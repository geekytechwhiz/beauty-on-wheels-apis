
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      violation: 'Controllers must call services, not repositories directly.',
    },
  },
  create(context: any) {
    return {};
  },
};
