'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Removes AWS::Logs::LogGroup from the compiled template before deploy.
 *
 * Vendor-service root stack sits at the CloudFormation 500-resource ceiling.
 * Serverless creates one LogGroup per function (~100 resources) that cannot be
 * force-migrated into a nested stack (fixed /aws/lambda/* names collide).
 * CloudWatch recreates log groups automatically on first invoke; retention is
 * no longer managed by this stack.
 *
 * Also drops DependsOn / Ref / Fn::GetAtt edges that pointed at the removed
 * LogGroups so the template stays valid.
 */
class StripLogGroups {
  constructor(serverless) {
    this.serverless = serverless;
    this.hooks = {
      'after:aws:package:finalize:mergeCustomProviderResources':
        this.strip.bind(this),
    };
  }

  collectLogGroupIds(resources) {
    return new Set(
      Object.keys(resources || {}).filter(
        (id) => resources[id].Type === 'AWS::Logs::LogGroup',
      ),
    );
  }

  scrubNode(value, removedIds) {
    if (Array.isArray(value)) {
      const next = value
        .map((item) => this.scrubNode(item, removedIds))
        .filter((item) => item !== undefined);
      return next;
    }
    if (!value || typeof value !== 'object') {
      return value;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'Ref')) {
      return removedIds.has(value.Ref) ? undefined : value;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'Fn::GetAtt')) {
      const target = Array.isArray(value['Fn::GetAtt'])
        ? value['Fn::GetAtt'][0]
        : undefined;
      return removedIds.has(target) ? undefined : value;
    }

    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'DependsOn') {
        const deps = Array.isArray(child) ? child : [child];
        const filtered = deps.filter((dep) => !removedIds.has(dep));
        if (filtered.length === 1) out.DependsOn = filtered[0];
        else if (filtered.length > 1) out.DependsOn = filtered;
        continue;
      }
      const scrubbed = this.scrubNode(child, removedIds);
      if (scrubbed !== undefined) out[key] = scrubbed;
    }
    return out;
  }

  stripTemplate(template) {
    if (!template?.Resources) return 0;
    const removedIds = this.collectLogGroupIds(template.Resources);
    if (removedIds.size === 0) return 0;

    for (const id of removedIds) {
      delete template.Resources[id];
    }

    for (const [logicalId, resource] of Object.entries(template.Resources)) {
      template.Resources[logicalId] = this.scrubNode(resource, removedIds);
    }

    if (template.Outputs) {
      template.Outputs = this.scrubNode(template.Outputs, removedIds);
    }

    return removedIds.size;
  }

  strip() {
    const template =
      this.serverless.service.provider.compiledCloudFormationTemplate;
    let removed = this.stripTemplate(template);

    const serviceDir =
      this.serverless.config?.servicePath ||
      this.serverless.serviceDir ||
      process.cwd();
    const serverlessDir = path.join(serviceDir, '.serverless');
    if (fs.existsSync(serverlessDir)) {
      for (const file of fs.readdirSync(serverlessDir)) {
        if (
          !file.startsWith('cloudformation-template-') ||
          !file.endsWith('.json')
        ) {
          continue;
        }
        const full = path.join(serverlessDir, file);
        try {
          const nested = JSON.parse(fs.readFileSync(full, 'utf8'));
          const n = this.stripTemplate(nested);
          if (n > 0) {
            fs.writeFileSync(full, JSON.stringify(nested));
            removed += n;
          }
        } catch {
          // Ignore non-template JSON.
        }
      }
    }

    if (removed > 0) {
      this.serverless.cli.log(
        `[strip-log-groups] Removed ${removed} AWS::Logs::LogGroup resource(s) to stay under the CloudFormation 500 limit`,
      );
    }
  }
}

module.exports = StripLogGroups;
