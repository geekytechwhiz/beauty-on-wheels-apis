type CFResource = Record<string, any>;

class ResourceRegistryPlugin {
  serverless: any;
  options: any;
  hooks: Record<string, () => void>;

  constructor(serverless: any, options: any) {
    this.serverless = serverless;
    this.options = options;

    this.hooks = {
      "before:package:finalize": this.generateResources.bind(this),
    };
  }

  private log(message: string) {
    this.serverless.cli.log(`[resource-registry] ${message}`);
  }

  private getConfig() {
    const service = this.serverless.service;
    return {
      enabled:
        service.custom?.resourceRegistry?.enabled ?? true,
      serviceName: service.service,
      stage:
        this.options.stage ||
        service.provider?.stage ||
        "dev",
    };
  }

  generateResources() {
    const config = this.getConfig();

    if (!config.enabled) {
      this.log("disabled");
      return;
    }

    const resources =
      this.serverless.service.resources?.Resources || {};

    const generated: Record<string, CFResource> = {};
 
    Object.entries(resources).forEach(
      ([logicalId, resource]: [string, any]) => {
        switch (resource.Type) {
          case "AWS::DynamoDB::Table":
            this.addParameter(
              generated,
              `${logicalId}NameParameter`,
              `/${config.stage}/${config.serviceName}/dynamodb/${logicalId}/name`,
              { Ref: logicalId }
            );

            this.addParameter(
              generated,
              `${logicalId}ArnParameter`,
              `/${config.stage}//${config.serviceName}/dynamodb/${logicalId}/arn`,
              { "Fn::GetAtt": [logicalId, "Arn"] }
            );
            break;

          case "AWS::Events::EventBus":
            this.addParameter(
              generated,
              `${logicalId}NameParameter`,
              `/${config.stage}/${config.serviceName}/eventbridge/${logicalId}/name`,
              { Ref: logicalId },
            );

            this.addParameter(
              generated,
              `${logicalId}ArnParameter`,
              `/${config.stage}/${config.serviceName}/eventbridge/${logicalId}/arn`,
              { 'Fn::GetAtt': [logicalId, 'Arn'] },
            );
            break;

          case "AWS::SQS::Queue":
            this.addParameter(
              generated,
              `${logicalId}UrlParameter`,
              `/${config.stage}/${config.serviceName}/sqs/${logicalId}/url`,
              { Ref: logicalId }
            );

            this.addParameter(
              generated,
              `${logicalId}ArnParameter`,
              `/${config.stage}/${config.serviceName}/sqs/${logicalId}/arn`,
              { "Fn::GetAtt": [logicalId, "Arn"] }
            );
            break;

          case "AWS::SNS::Topic":
            this.addParameter(
              generated,
              `${logicalId}ArnParameter`,
              `/${config.stage}/${config.serviceName}/sns/${logicalId}/arn`,
              { Ref: logicalId }
            );
            break;
        }
      }
    );

    generated["ApiGatewayUrlParameter"] = {
      Type: "AWS::SSM::Parameter",
      Properties: {
        Name: `/${config.stage}/${config.serviceName}/api-base-url`,
        Type: "String",
        Value: {
          "Fn::Sub":
            "https://${ApiGatewayRestApi}.execute-api.${AWS::Region}.amazonaws.com/" +
            config.stage,
        },
      },
    };

    this.serverless.service.resources =
      this.serverless.service.resources || {};

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
    value: any
  ) {
    resources[logicalId] = {
      Type: "AWS::SSM::Parameter",
      Properties: {
        Name: parameterName,
        Type: "String",
        Value: value,
      },
    };
  }
}

module.exports = ResourceRegistryPlugin;
export = ResourceRegistryPlugin;
