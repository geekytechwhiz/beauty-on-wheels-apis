/**
 * --------------------------------------------------------
 * Serverless Builder
 *
 * Builds a serverless deployment model
 * from the parsed OpenAPI metadata.
 *
 * It DOES NOT generate YAML.
 *
 * --------------------------------------------------------
 */

class ServerlessBuilder {
  constructor(metadata) {
    this.metadata = metadata;
  }

  build() {
    return {
      service: `${this.metadata.service}-service`,

      provider: this.buildProvider(),

      package: this.buildPackage(),

      plugins: this.buildPlugins(),

      custom: this.buildCustom(),

      functions: this.buildFunctions(),

      iam: this.buildIam(),

      environment: this.buildEnvironment(),
    };
  }

  buildProvider() {
    return {
      runtime: 'nodejs22.x',

      stage: "${opt:stage,'dev'}",

      region: "${opt:region,'us-east-1'}",

      timeout: 30,

      memorySize: 512,

      logRetentionInDays: 14,

      tracing: {
        lambda: true,

        apiGateway: true,
      },
    };
  }

  buildPackage() {
    return {
      individually: true,
    };
  }

  buildPlugins() {
    return [
      'serverless-esbuild',
      'serverless-dotenv-plugin',
      'serverless-auto-swagger',
      'serverless-offline',
    ];
  }

  buildCustom() {
    return {
      esbuild: {
        bundle: true,

        minify: false,

        sourcemap: true,

        target: 'node22',

        platform: 'node',

        concurrency: 10,

        plugins: './esbuild-plugins.js',
      },
      autoswagger: {
        title: this.metadata.title || `${this.metadata.service}-service API`,
        apiType: 'http',
        basePath: '/${self:provider.stage}',
        generateSwaggerOnDeploy: true,
        useStage: true,
        swaggerPath: 'swagger',
      },
    };
  }

  buildFunctions() {
    const functions = [];

    this.metadata.resources.forEach((resource) => {
      resource.operations.forEach((operation) => {
        functions.push({
          name: operation.methodName,

          handler: `src/handlers/${resource.fileName}.handler.${operation.handlerName}`,

          method: operation.method.toLowerCase(),

          path: operation.path,

          operation: `${resource.fileName}.${operation.methodName}`,

          authorizer: this.requiresAuthorizer(operation),

          cors: true,
        });
      });
    });

    return functions;
  }

  buildIam() {
    return {
      dynamodb: true,

      secretsManager: true,

      sns: true,

      eventBridge: true,

      cloudWatch: true,

      xray: true,
    };
  }

  buildEnvironment() {
    return {
      SERVICE_NAME: `${this.metadata.service}-service`,

      LOG_LEVEL: '${ssm:/common/log-level}',

      DYNAMODB_TABLE_NAME: '${ssm:/common/dynamodb/table}',

      EVENT_BUS_NAME: '${ssm:/common/eventbus/name}',
    };
  }

  requiresAuthorizer(operation) {
    const publicEndpoints = [
      '/auth/login',

      '/auth/register',

      '/auth/refresh-token',

      '/otp/send',

      '/otp/verify',

      '/health',
    ];

    return !publicEndpoints.includes(operation.path);
  }
}

module.exports = ServerlessBuilder;
