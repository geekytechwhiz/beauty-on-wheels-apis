const yaml = require('js-yaml');

class IamPolicyGenerator {
  constructor() {
    this.resources = [];
  }

  /**
   * Register an AWS resource internally.
   * @param {string} type - AWS resource type (e.g. AWS::DynamoDB::Table)
   * @param {string} name - Cleaned resource name
   * @param {string} arnPattern - Derived least-privilege ARN pattern
   */
  registerResource(type, name, arnPattern) {
    // Avoid duplicate registration
    const exists = this.resources.some(
      r => r.type === type && r.name === name && r.arnPattern === arnPattern
    );
    if (!exists) {
      this.resources.push({ type, name, arnPattern });
    }
  }

  /**
   * Parse a CloudFormation Resources block and register standard AWS resources.
   * @param {object} resourcesBlock - The Resources block of serverless/CloudFormation template
   */
  parseAndRegisterResources(resourcesBlock) {
    if (!resourcesBlock || typeof resourcesBlock !== 'object') {
      return;
    }

    Object.entries(resourcesBlock).forEach(([logicalId, resource]) => {
      if (!resource || typeof resource !== 'object') return;
      const type = resource.Type;
      if (!type) return;

      let resourceName = '';
      let arnPattern = '';

      switch (type) {
        case 'AWS::DynamoDB::Table': {
          const tableName = resource.Properties?.TableName;
          resourceName = extractResourceName(tableName, logicalId);
          arnPattern = `arn:aws:dynamodb:\${aws:region}:\${aws:accountId}:table/BW/\${self:provider.stage}/${resourceName}`;
          this.registerResource(type, resourceName, arnPattern);
          break;
        }
        case 'AWS::SQS::Queue': {
          const queueName = resource.Properties?.QueueName;
          resourceName = extractResourceName(queueName, logicalId);
          arnPattern = `arn:aws:sqs:\${aws:region}:\${aws:accountId}:BW/\${self:provider.stage}/${resourceName}`;
          this.registerResource(type, resourceName, arnPattern);
          break;
        }
        case 'AWS::SNS::Topic': {
          const topicName = resource.Properties?.TopicName;
          resourceName = extractResourceName(topicName, logicalId);
          arnPattern = `arn:aws:sns:\${aws:region}:\${aws:accountId}:BW/\${self:provider.stage}/${resourceName}`;
          this.registerResource(type, resourceName, arnPattern);
          break;
        }
        case 'AWS::Events::EventBus': {
          const busName = resource.Properties?.Name;
          resourceName = extractResourceName(busName, logicalId);
          arnPattern = `arn:aws:events:\${aws:region}:\${aws:accountId}:event-bus/BW/\${self:provider.stage}/${resourceName}`;
          this.registerResource(type, resourceName, arnPattern);
          break;
        }
        case 'AWS::S3::Bucket': {
          const bucketName = resource.Properties?.BucketName;
          resourceName = extractResourceName(bucketName, logicalId);
          arnPattern = `arn:aws:s3:::BW/\${self:provider.stage}/${resourceName}`;
          this.registerResource(type, resourceName, arnPattern);
          break;
        }
        case 'AWS::SecretsManager::Secret': {
          const secretName = resource.Properties?.Name;
          resourceName = extractResourceName(secretName, logicalId);
          arnPattern = `arn:aws:secretsmanager:\${aws:region}:\${aws:accountId}:secret:BW/\${self:provider.stage}/${resourceName}-*`;
          this.registerResource(type, resourceName, arnPattern);
          break;
        }
        case 'AWS::SSM::Parameter': {
          const paramName = resource.Properties?.Name;
          resourceName = extractResourceName(paramName, logicalId);
          arnPattern = `arn:aws:ssm:\${aws:region}:\${aws:accountId}:parameter/BW/\${self:provider.stage}/${resourceName}`;
          this.registerResource(type, resourceName, arnPattern);
          break;
        }
        default:
          // Ignore unsupported/non-standard resource types
          break;
      }
    });
  }

  /**
   * Generate IAM Policy Statements from registered resources.
   * @returns {Array<object>} List of IAM policy statements
   */
  generateStatements() {
    const statements = [];

    // 1. Group DynamoDB Table and Index permissions
    const ddbResources = this.resources.filter(r => r.type === 'AWS::DynamoDB::Table');
    if (ddbResources.length > 0) {
      const resourcesList = [];
      ddbResources.forEach(r => {
        resourcesList.push(r.arnPattern);
        resourcesList.push(`${r.arnPattern}/index/*`);
      });
      statements.push({
        Effect: 'Allow',
        Action: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
          'dynamodb:BatchGetItem',
          'dynamodb:BatchWriteItem',
          'dynamodb:DescribeTable'
        ],
        Resource: resourcesList
      });
    }

    // 2. SQS Queue permissions
    const sqsResources = this.resources.filter(r => r.type === 'AWS::SQS::Queue');
    if (sqsResources.length > 0) {
      statements.push({
        Effect: 'Allow',
        Action: [
          'sqs:SendMessage',
          'sqs:ReceiveMessage',
          'sqs:DeleteMessage',
          'sqs:ChangeMessageVisibility',
          'sqs:GetQueueAttributes'
        ],
        Resource: sqsResources.map(r => r.arnPattern)
      });
    }

    // 3. SNS Topic permissions
    const snsResources = this.resources.filter(r => r.type === 'AWS::SNS::Topic');
    if (snsResources.length > 0) {
      statements.push({
        Effect: 'Allow',
        Action: ['sns:Publish'],
        Resource: snsResources.map(r => r.arnPattern)
      });
    }

    // 4. EventBridge EventBus permissions
    const eventBusResources = this.resources.filter(r => r.type === 'AWS::Events::EventBus');
    if (eventBusResources.length > 0) {
      statements.push({
        Effect: 'Allow',
        Action: ['events:PutEvents'],
        Resource: eventBusResources.map(r => r.arnPattern)
      });
    }

    // 5. S3 Bucket permissions (both Bucket and Bucket/*)
    const s3Resources = this.resources.filter(r => r.type === 'AWS::S3::Bucket');
    if (s3Resources.length > 0) {
      const resourcesList = [];
      s3Resources.forEach(r => {
        resourcesList.push(r.arnPattern);
        resourcesList.push(`${r.arnPattern}/*`);
      });
      statements.push({
        Effect: 'Allow',
        Action: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket'
        ],
        Resource: resourcesList
      });
    }

    // 6. Secrets Manager permissions
    const secretsResources = this.resources.filter(r => r.type === 'AWS::SecretsManager::Secret');
    if (secretsResources.length > 0) {
      statements.push({
        Effect: 'Allow',
        Action: ['secretsmanager:GetSecretValue'],
        Resource: secretsResources.map(r => r.arnPattern)
      });
    }

    // 7. SSM Parameter Store permissions (always restricted to BW/<stage>/*)
    const ssmResources = this.resources.filter(r => r.type === 'AWS::SSM::Parameter');
    if (ssmResources.length > 0) {
      statements.push({
        Effect: 'Allow',
        Action: [
          'ssm:GetParameter',
          'ssm:GetParameters',
          'ssm:GetParametersByPath'
        ],
        Resource: [`arn:aws:ssm:\${aws:region}:\${aws:accountId}:parameter/BW/\${self:provider.stage}/*`]
      });
    }

    // 8. CloudWatch Logs (Always included, no Resource: "*")
    statements.push({
      Effect: 'Allow',
      Action: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents'
      ],
      Resource: [`arn:aws:logs:\${aws:region}:\${aws:accountId}:*`]
    });

    // 9. X-Ray (Always included, Resource: "*" required by AWS)
    statements.push({
      Effect: 'Allow',
      Action: [
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords'
      ],
      Resource: '*'
    });

    return statements;
  }
}

/**
 * Clean and extract a resource name from its definition or fallback to Logical ID.
 * @param {any} value - Property value of the resource name
 * @param {string} logicalId - The CloudFormation logical ID
 * @returns {string} kebab-case resource name
 */
function extractResourceName(value, logicalId) {
  if (value && typeof value === 'object') {
    if (value.Ref) {
      return camelToKebab(value.Ref);
    }
    const subVal = value['Fn::Sub'] || value['fn::sub'];
    if (subVal && typeof subVal === 'string') {
      value = subVal;
    } else {
      value = JSON.stringify(value);
    }
  }

  if (typeof value !== 'string') {
    return camelToKebab(logicalId);
  }

  let cleaned = value;
  // Remove variable references like ${self:provider.stage}, ${sls:stage}, ${self:service}, etc.
  cleaned = cleaned.replace(/\$\{[^}]+\}/g, '');
  // Remove stage names
  cleaned = cleaned.replace(/\b(dev|stage|prod|stg|prd|test)\b/gi, '');
  // Remove BW/ or BW- prefix
  cleaned = cleaned.replace(/^BW\//i, '');
  cleaned = cleaned.replace(/^BW-/i, '');

  // Clean leading/trailing slashes and dashes
  cleaned = cleaned.trim().replace(/^[-/_]+|[-/_]+$/g, '');
  cleaned = cleaned.replace(/[\/_]+/g, '-');

  if (!cleaned) {
    return camelToKebab(logicalId);
  }
  return cleaned;
}

function camelToKebab(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

module.exports = IamPolicyGenerator;
