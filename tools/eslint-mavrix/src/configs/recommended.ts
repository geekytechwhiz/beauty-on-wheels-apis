export default {
    plugins: ['mavrix'],
    rules: {
      'mavrix/event-name': 'error',
      'mavrix/event-publish': 'error',
      'mavrix/require-idempotency-key': 'error',
      'mavrix/no-cross-service-import': 'error',
      'mavrix/no-deep-relative-import': 'warn',
    },
  };