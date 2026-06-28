# mvrx-resource-registry

Serverless Framework plugin that publishes CloudFormation resource identifiers and custom configuration values to AWS SSM Parameter Store during deploy.

## Usage

Add to `serverless.yml`:

```yaml
plugins:
  - '@myvitalrx/mvrx-resource-registry'

custom:
  resourceRegistry:
    enabled: true
    include:
      - AWS::DynamoDB::Table
      - AWS::Events::EventBus
      - AWS::SQS::Queue
      - AWS::SNS::Topic
```

## Auto-generated SSM paths

For each included CloudFormation resource, the plugin creates SSM parameters:

| Resource type | SSM paths |
|---|---|
| `AWS::DynamoDB::Table` | `/{stage}/{service}/dynamodb/{logicalId}/name`, `.../arn` |
| `AWS::Events::EventBus` | `/{stage}/{service}/eventbridge/{logicalId}/name`, `.../arn` |
| `AWS::SQS::Queue` | `/{stage}/{service}/sqs/{logicalId}/url`, `.../arn` |
| `AWS::SNS::Topic` | `/{stage}/{service}/sns/{logicalId}/arn` |

When the service defines HTTP or HTTP API events, an additional parameter is created at `/{stage}/{service}/api-base-url`.

Use `include` to restrict which resource types are registered. When `include` is empty, all supported types are included. Use `exclude` to skip specific types.

## Custom parameters

Declare static or Serverless-resolved values under `resourceRegistry.parameters`. Each entry requires a `value` field:

```yaml
custom:
  resourceRegistry:
    enabled: true
    platformOwner: platform-config   # optional; defaults to mvrx
    parameters:
      NODEJS_RUNTIME:
        value: nodejs22.x
      DEFAULT_AWS_REGION:
        value: ${self:provider.region}
```

Custom parameters are stored at:

```
/{stage}/{platformOwner}/{KEY}
```

Examples (stage `dev`):

- Default `platformOwner`: `/dev/mvrx/NODEJS_RUNTIME`
- Override `platformOwner: platform-config`: `/dev/platform-config/NODEJS_RUNTIME`

`value` accepts plain strings (including Serverless variable resolution) or CloudFormation intrinsics (`Ref`, `Fn::GetAtt`, etc.).

## Configuration reference

| Key | Default | Description |
|---|---|---|
| `enabled` | `true` | Toggle plugin |
| `include` | `[]` | CF resource types to register (empty = all supported) |
| `exclude` | `[]` | CF resource types to skip |
| `tags` | `{}` | Tags applied to all SSM parameters |
| `platformOwner` | `mvrx` | Path segment for custom parameters |
| `parameters` | `{}` | Custom key/value pairs to publish to SSM |

## Building

Run `nx build mvrx-resource-registry` to build the library.
