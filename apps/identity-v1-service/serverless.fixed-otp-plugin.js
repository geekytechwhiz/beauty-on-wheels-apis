'use strict';

function isEnabled(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function validateFixedOtpDeployment(stage, enabled) {
  if (isEnabled(enabled) && String(stage ?? '').trim().toLowerCase() !== 'dev') {
    throw new Error('FIXED_OTP_ENABLED may only be deployed to the dev stage');
  }
}

class FixedOtpDeploymentGuard {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      'before:package:initialize': () => this.validate(),
      'before:deploy:deploy': () => this.validate(),
    };
  }

  validate() {
    const stage = this.options.stage || this.serverless.service.provider.stage;
    const enabled = this.serverless.service.provider.environment.FIXED_OTP_ENABLED;
    validateFixedOtpDeployment(stage, enabled);
  }
}

module.exports = FixedOtpDeploymentGuard;
module.exports.validateFixedOtpDeployment = validateFixedOtpDeployment;
