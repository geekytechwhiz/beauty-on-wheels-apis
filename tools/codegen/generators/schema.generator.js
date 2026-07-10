const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SchemaRenderer = require('../schema/schema-renderer');

module.exports = function generateSchemas(projectRoot, metadata) {
  console.log('');
  console.log('========================================');
  console.log('Generating Schemas');
  console.log('========================================');
  console.log('');

  const schemasDir = path.join(projectRoot, 'src', 'schemas');

  fs.mkdirSync(schemasDir, {
    recursive: true,
  });

  /**
   * Load original OpenAPI document
   */

  const openApi = yaml.load(fs.readFileSync(metadata.openApiFile, 'utf8'));

  const renderer = new SchemaRenderer(openApi);

  for (const resource of metadata.resources) {
    const content = renderer.render(resource);

    const file = path.join(
      schemasDir,

      `${resource.fileName}.schema.ts`,
    );

    fs.writeFileSync(
      file,

      content,

      'utf8',
    );

    console.log(`✓ ${resource.fileName}.schema.ts`);
  }

  console.log('');
  console.log('Schema generation completed.');
  console.log('');
};
