const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const IamPolicyGenerator = require('./iam-policy-generator');

class ServerlessRenderer {
  constructor(model) {
    this.model = model;
    this.iamGenerator = new IamPolicyGenerator();
    this.mergedResources = {};
  }

  render(outputFile) {
    const template = this.loadTemplate();

    // 1. Load existing resources and outputs from target serverless.yml
    let existingResources = {};
    let existingOutputs = {};
    if (fs.existsSync(outputFile)) {
      try {
        const existingContent = fs.readFileSync(outputFile, 'utf8');
        const parsed = yaml.load(existingContent);
        if (parsed && parsed.resources) {
          if (parsed.resources.Resources) {
            existingResources = parsed.resources.Resources;
          }
          if (parsed.resources.Outputs) {
            existingOutputs = parsed.resources.Outputs;
          }
        }
      } catch (err) {
        console.warn(`Warning: Could not parse existing serverless.yml: ${err.message}`);
      }
    }

    // 2. Load default resources from template
    let templateResources = {};
    try {
      const lines = template.split('\n');
      const resourcesIndex = lines.findIndex(line => line.trim() === 'resources:');
      if (resourcesIndex !== -1) {
        const resourcesYaml = lines.slice(resourcesIndex).join('\n');
        const parsed = yaml.load(resourcesYaml);
        if (parsed && parsed.resources && parsed.resources.Resources) {
          templateResources = parsed.resources.Resources;
        }
      }
    } catch (err) {
      console.warn(`Warning: Could not parse template resources: ${err.message}`);
    }

    // 3. Merge all resources for IAM Policy Generation
    const allResources = Object.assign({}, templateResources, existingResources);
    this.iamGenerator.parseAndRegisterResources(allResources);

    // 4. Extract custom resources (not in template)
    const customResources = {};
    const defaultKeys = new Set(Object.keys(templateResources));
    Object.entries(existingResources).forEach(([key, val]) => {
      if (!defaultKeys.has(key)) {
        customResources[key] = val;
      }
    });

    this.customResources = customResources;
    this.customOutputs = existingOutputs;

    const renderedYaml = this.renderTemplate(template);

    fs.writeFileSync(outputFile, renderedYaml, 'utf8');
  }

  loadTemplate() {
    const templateFile = path.join(
      __dirname,
      '..',
      'serverless/templates',
      'serverless.template.yml',
    );

    if (!fs.existsSync(templateFile)) {
      throw new Error(`Template not found: ${templateFile}`);
    }

    return fs.readFileSync(templateFile, 'utf8');
  }

  renderTemplate(template) {
    let yamlStr = template;

    yamlStr = yamlStr.replace('{{SERVICE_NAME}}', this.model.service);

    yamlStr = yamlStr.replace('{{FUNCTIONS}}', this.renderFunctions());

    yamlStr = yamlStr.replace('{{ENVIRONMENT}}', this.renderEnvironment());

    yamlStr = yamlStr.replace('{{PLUGINS}}', this.renderPlugins());

    yamlStr = yamlStr.replace('{{CUSTOM}}', this.renderCustom());

    yamlStr = yamlStr.replace('{{IAM}}', this.renderIam());

    // Replace the resources block by injecting custom resources and appending custom outputs
    yamlStr = this.replaceResourcesBlock(yamlStr);

    return yamlStr;
  }

  replaceResourcesBlock(yamlStr) {
    const lines = yamlStr.split('\n');
    const resourcesIndex = lines.findIndex(line => line.trim() === 'resources:');
    if (resourcesIndex === -1) {
      return yamlStr;
    }

    const resourcesSectionLines = lines.slice(resourcesIndex);
    const relativeResourcesLineIndex = resourcesSectionLines.findIndex(line => line.trim() === 'Resources:');
    if (relativeResourcesLineIndex === -1) {
      return yamlStr;
    }

    const resourcesLineIndex = resourcesIndex + relativeResourcesLineIndex;

    // Insert custom resources under Resources: (indented by 4 spaces)
    if (this.customResources && Object.keys(this.customResources).length > 0) {
      const customResourcesYaml = yaml.dump(this.customResources, { indent: 2, skipInvalid: true })
        .split('\n')
        .map(line => line ? '    ' + line : '')
        .join('\n');
      lines.splice(resourcesLineIndex + 1, 0, customResourcesYaml);
    }

    // Append custom outputs at the end (indented by 2 spaces)
    if (this.customOutputs && Object.keys(this.customOutputs).length > 0) {
      const customOutputsYaml = yaml.dump({ Outputs: this.customOutputs }, { indent: 2, skipInvalid: true })
        .split('\n')
        .map(line => line ? '  ' + line : '')
        .join('\n');
      lines.push(customOutputsYaml);
    }

    return lines.join('\n');
  }

  renderFunctions() {
    return this.model.functions.map((f) => this.renderFunction(f)).join('\n');
  }

  renderFunction(f) {
    let details = '';
    if (f.summary) {
      details += `\n          summary: ${JSON.stringify(f.summary)}`;
    }
    if (f.description) {
      details += `\n          description: ${JSON.stringify(f.description)}`;
    }
    if (f.swaggerTags && f.swaggerTags.length > 0) {
      details += `\n          swaggerTags:\n` + f.swaggerTags.map(tag => `            - ${tag}`).join('\n');
    }
    if (f.bodyType) {
      details += `\n          bodyType: ${f.bodyType}`;
    }
    if (f.responseData && Object.keys(f.responseData).length > 0) {
      details += `\n          responseData:`;
      Object.entries(f.responseData).forEach(([code, res]) => {
        details += `\n            ${code}:`;
        if (res.bodyType) {
          details += `\n              description: ${JSON.stringify(res.description || '')}\n              bodyType: ${res.bodyType}`;
        } else {
          details += `\n              description: ${JSON.stringify(res.description || '')}`;
        }
      });
    }

    return `
  ${f.name}:
    handler: ${f.handler}
    events:
      - http:
          path: ${f.path}
          method: ${f.method}
          cors: ${f.cors}${details}
`;
  }

  renderEnvironment() {
    return Object.entries(this.model.environment)

      .map(([key, value]) => {
        return `    ${key}: ${value}`;
      })

      .join('\n');
  }

  renderPlugins() {
    return this.model.plugins

      .map((plugin) => `  - ${plugin}`)

      .join('\n');
  }

  renderCustom() {
    const esbuild = this.model.custom.esbuild;
    const autoswagger = this.model.custom.autoswagger;

    let typefilesYaml = '';
    if (autoswagger.typefiles && autoswagger.typefiles.length > 0) {
      typefilesYaml = '\n    typefiles:\n' + autoswagger.typefiles.map(t => `      - ${t}`).join('\n');
    }

    return `
  esbuild:
    bundle: ${esbuild.bundle}
    minify: ${esbuild.minify}
    sourcemap: ${esbuild.sourcemap}
    target: ${esbuild.target}
    platform: ${esbuild.platform}
    concurrency: ${esbuild.concurrency}
    plugins: ${esbuild.plugins}

  autoswagger:
    title: "${autoswagger.title}"
    apiType: ${autoswagger.apiType}
    basePath: ${autoswagger.basePath}
    schemes:
      - https
      - http
    generateSwaggerOnDeploy: ${autoswagger.generateSwaggerOnDeploy}
    swaggerFiles:
      - swagger.json
    useStage: ${autoswagger.useStage}
    swaggerPath: ${autoswagger.swaggerPath}${typefilesYaml}
    excludeStages:
      - production
`;
  }

  renderIam() {
    const statements = this.iamGenerator.generateStatements();
    if (statements.length === 0) {
      return '    # No IAM statements generated';
    }
    return yaml.dump(statements, { indent: 2, skipInvalid: true })
      .split('\n')
      .map(line => line ? '  ' + line : '')
      .join('\n');
  }
}

module.exports = ServerlessRenderer;
