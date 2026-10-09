const { validateFixedOtpDeployment } = require('../serverless.fixed-otp-plugin');

describe('fixed OTP Serverless deployment guard', () => {
  it.each(['staging', 'prod', 'production'])('rejects enabled fixed OTP in %s', (stage) => {
    expect(() => validateFixedOtpDeployment(stage, 'true')).toThrow(
      'FIXED_OTP_ENABLED may only be deployed to the dev stage',
    );
  });

  it('allows fixed OTP only in dev and allows disabled production deployments', () => {
    expect(() => validateFixedOtpDeployment('dev', 'true')).not.toThrow();
    expect(() => validateFixedOtpDeployment('production', 'false')).not.toThrow();
  });
});
