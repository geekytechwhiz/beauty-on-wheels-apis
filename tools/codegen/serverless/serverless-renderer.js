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
    return `
  ${f.name}:
    handler: ${f.handler}
    events:
      - http:
          path: ${f.path}
          method: ${f.method}
          cors: ${f.cors}
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
    swaggerPath: ${autoswagger.swaggerPath}
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
