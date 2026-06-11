
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      violation: 'Public endpoints require OpenAPI annotations.',
    },
  },
  create(context: any) {
    return {};
  },
};
