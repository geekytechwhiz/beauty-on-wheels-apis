const fs = require('fs');
const path = require('path');

class ServerlessRenderer {
  constructor(model) {
    this.model = model;
  }

  render(outputFile) {
    const template = this.loadTemplate();

    const yaml = this.renderTemplate(template);

    fs.writeFileSync(outputFile, yaml, 'utf8');
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
    let yaml = template;

    yaml = yaml.replace('{{SERVICE_NAME}}', this.model.service);

    yaml = yaml.replace('{{FUNCTIONS}}', this.renderFunctions());

    yaml = yaml.replace('{{ENVIRONMENT}}', this.renderEnvironment());

    yaml = yaml.replace('{{PLUGINS}}', this.renderPlugins());

    yaml = yaml.replace('{{CUSTOM}}', this.renderCustom());

    yaml = yaml.replace('{{IAM}}', this.renderIam());

    return yaml;
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
    return `
    # IAM policies are injected from the enterprise template.
`;
  }
}

module.exports = ServerlessRenderer;
