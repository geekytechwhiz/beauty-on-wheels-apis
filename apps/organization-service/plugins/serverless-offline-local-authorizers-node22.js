'use strict';

class ServerlessOfflineLocalAuthorizersNode22 {
  constructor(serverless) {
    this.serverless = serverless;
    this.hooks = {
      'before:offline:start:init': this.applyLocalAuthorizers.bind(this),
      'before:offline:start': this.applyLocalAuthorizers.bind(this),
    };
    this.applied = false;
  }

  log(msg) {
    this.serverless.cli.log(`[local-authorizers-node22] ${msg}`);
  }

  applyLocalAuthorizers() {
    if (this.applied) return;
    this.applied = true;

    const service = this.serverless.service;
    const functions = service.functions || {};
    const provider = service.provider || {};
    const providerRuntime = provider.runtime || 'nodejs22.x';
    const stage = provider.stage || 'dev';

    let injected = 0;

    for (const fnDef of Object.values(functions)) {
      if (!fnDef || !Array.isArray(fnDef.events)) continue;

      for (const evt of fnDef.events) {
        if (!evt || typeof evt !== 'object' || !evt.http) continue;
        const http = evt.http;
        if (!http.localAuthorizer || !http.authorizer) continue;

        const local = http.localAuthorizer;
        const localName = local.name;
        const pathFile = local.pathFile || 'local-authorizers.js';
        const handlerModule = String(pathFile).replace(/\.(cjs|mjs|js|ts)$/i, '');
        if (!localName || typeof localName !== 'string') continue;

        const generatedFnName = `$__LOCAL_AUTHORIZER_${localName}`;
        const localType = String(local.type || 'token').toLowerCase() === 'request' ? 'request' : 'token';

        if (!functions[generatedFnName]) {
          functions[generatedFnName] = {
            handler: `${handlerModule}.${localName}`,
            memorySize: 128,
            timeout: 10,
            runtime: providerRuntime,
            name: `${service.service}-${stage}-${generatedFnName}`,
          };
          injected++;
        }

        // Replace real ARN authorizer with local authorizer function reference.
        const identitySource =
          http.authorizer.identitySource ||
          (localType === 'token' ? 'method.request.header.Authorization' : 'method.request.header.Authorization');
        http.authorizer = {
          name: generatedFnName,
          type: localType,
          identitySource,
          resultTtlInSeconds: 0,
        };
      }
    }

    this.log(`injected ${injected} local authorizer function(s) with runtime ${providerRuntime}`);
  }
}

module.exports = ServerlessOfflineLocalAuthorizersNode22;
