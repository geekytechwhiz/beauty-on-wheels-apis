type CFResource = Record<string, any>;

class ResourceRegistryPlugin {
  serverless: any;
  options: any;
  hooks: Record<string, () => void>;

  constructor(serverless: any, options: any) {
    this.serverless = serverless;
    this.options = options;

    this.hooks = {
      'before:package:finalize': this.generateResources.bind(this),
    };
  }

  private log(message: string) {
    this.serverless.cli.log(`[resource-registry] ${message}`);
  }

  private getConfig() {
    const service = this.serverless.service;
    const registry = service.custom?.resourceRegistry ?? {};

    return {
      enabled: registry.enabled ?? true,
      include: registry.include ?? [],
      exclude: registry.exclude ?? [],
      defaults: registry.defaults ?? {},
      tags: registry.tags ?? {},
      parameters: registry.parameters ?? {},
      platformOwner:  "mvrx",
      serviceName: service.service,
      stage: this.options.stage || service.provider?.stage || 'dev',
    };
  }

  generateResources() {
    const config = this.getConfig();

    if (!config.enabled) {
      this.log('disabled');
      return;
    }
    const included = new Set(config.include);
    const excluded = new Set(config.exclude);
    const parameters = config.parameters;
    Object.entries(parameters).forEach(
      ([key, definition]: [string, any]) => {
        if (!definition || definition.value === undefined) {
          throw new Error(
            `resourceRegistry.parameters.${key}.value is required`,
          );
        }
      },
    );

    const resources = {...this.serverless.service.resources?.Resources || {}, ...parameters};

    const generated: Record<string, CFResource> = {};

    Object.entries(resources).forEach(
      ([logicalId, resource]: [string, any]) => {
        const shouldInclude =
          included.size === 0 || included.has(resource.Type);

        const shouldExclude = excluded.has(resource.Type);

        if (!shouldInclude || shouldExclude) {
          return;
        }
        switch (resource.Type) {
          case 'AWS::DynamoDB::Table':
            this.addParameter(
              generated,
              `${logicalId}NameParameter`,
              `/${config.stage}/${config.serviceName}/dynamodb/${logicalId}/name`,
              { Ref: logicalId },
              config.tags,
            );

            this.addParameter(
              generated,
              `${logicalId}ArnParameter`,
              `/${config.stage}/${config.serviceName}/dynamodb/${logicalId}/arn`,
              { 'Fn::GetAtt': [logicalId, 'Arn'] },
              config.tags,
            );
            break;

          case 'AWS::Events::EventBus':
            this.addParameter(
              generated,
              `${logicalId}NameParameter`,
              `/${config.stage}/${config.serviceName}/eventbridge/${logicalId}/name`,
              { Ref: logicalId },
              config.tags,
            );

            this.addParameter(
              generated,
              `${logicalId}ArnParameter`,
              `/${config.stage}/${config.serviceName}/eventbridge/${logicalId}/arn`,
              { 'Fn::GetAtt': [logicalId, 'Arn'] },
              config.tags,
            );
            break;

          case 'AWS::SQS::Queue':
            this.addParameter(
              generated,
              `${logicalId}UrlParameter`,
              `/${config.stage}/${config.serviceName}/sqs/${logicalId}/url`,
              { Ref: logicalId },
              config.tags,
            );

            this.addParameter(
              generated,
              `${logicalId}ArnParameter`,
              `/${config.stage}/${config.serviceName}/sqs/${logicalId}/arn`,
              { 'Fn::GetAtt': [logicalId, 'Arn'] },
              config.tags,
            );
            break;

          case 'AWS::SNS::Topic':
            this.addParameter(
              generated,
              `${logicalId}ArnParameter`,
              `/${config.stage}/${config.serviceName}/sns/${logicalId}/arn`,
              { Ref: logicalId },
              config.tags,
            );
            break;
          default:
            this.addParameter(
              generated,
              `${logicalId}Parameter`,
              `/${config.stage}/${config.platformOwner}/${logicalId}/name`,
              { Ref: logicalId },
              config.tags,
            );
            break;
        }
      },
    );
   
    
     
    const hasApiGateway = Object.values(
      this.serverless.service.functions || {},
    ).some(
      (fn: any) =>
        Array.isArray(fn.events) &&
        fn.events.some((event: any) => event.http || event.httpApi),
    );

    if (hasApiGateway) {
      generated['ApiGatewayUrlParameter'] = {
        Type: 'AWS::SSM::Parameter',
        Properties: {
          Name: `/${config.stage}/${config.serviceName}/api-base-url`,
          Type: 'String',
          Value: {
            'Fn::Sub':
              'https://${ApiGatewayRestApi}.execute-api.${AWS::Region}.amazonaws.com/' +
              config.stage,
          },
          Tags: config.tags,
        },
      };
    }
    this.serverless.service.resources = this.serverless.service.resources || {};

    this.serverless.service.resources.Resources = {
      ...(this.serverless.service.resources.Resources || {}),
      ...generated,
    };

    this.log(`generated ${Object.keys(generated).length} SSM parameters`);
  }

  private addParameter(
    resources: Record<string, any>,
    logicalId: string,
    parameterName: string,
    value: any,
    tags: Record<string, string> = {},
  ) {
    resources[logicalId] = {
      Type: 'AWS::SSM::Parameter',
      Properties: {
        Name: parameterName,
        Type: 'String',
        Value: value,
        Tags: tags,
      },
    };
  }
}

module.exports = ResourceRegistryPlugin;
export = ResourceRegistryPlugin;
