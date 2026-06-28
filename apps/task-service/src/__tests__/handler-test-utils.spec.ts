import { bearerToken, minimalTaskMetaRecord, setupHandlerTestEnv, testLambdaContext } from './handler-test-utils';

describe('handler-test-utils', () => {
  it('bearerToken encodes payload for Authorization header', () => {
    const token = bearerToken({ 'custom:organizationID': 'org-1', 'custom:userID': 'u1' });
    expect(token).toMatch(/^Bearer header\./);
  });

  it('testLambdaContext exposes awsRequestId', () => {
    expect(testLambdaContext().awsRequestId).toBe('test-aws-request-id');
  });

  it('minimalTaskMetaRecord merges overrides', () => {
    const record = minimalTaskMetaRecord({ patientId: 'pat-override' });
    expect(record.patientId).toBe('pat-override');
    expect(record.runtimeTaskInstanceId).toBe('rtask-test-001');
  });

  it('testLambdaContext exposes remaining time', () => {
    expect(testLambdaContext().getRemainingTimeInMillis()).toBe(30000);
  });

  it('setupHandlerTestEnv respects pre-set env vars', () => {
    const prior = process.env.ERROR_MESSAGES_CDN_URL;
    process.env.ERROR_MESSAGES_CDN_URL = 'https://existing.example';
    const { restore } = setupHandlerTestEnv();
    expect(process.env.ERROR_MESSAGES_CDN_URL).toBe('https://existing.example');
    restore();
    process.env.ERROR_MESSAGES_CDN_URL = prior;
  });
});
