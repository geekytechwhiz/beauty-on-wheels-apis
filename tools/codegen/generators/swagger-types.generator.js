const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

module.exports = function generateSwaggerTypes(projectRoot, metadata) {
  console.log('');
  console.log('========================================');
  console.log('Generating Swagger API Types');
  console.log('========================================');
  console.log('');

  const typesDir = path.join(projectRoot, 'src', 'types');
  fs.mkdirSync(typesDir, { recursive: true });

  const openApi = yaml.load(fs.readFileSync(metadata.openApiFile, 'utf8'));
  const schemas = openApi.components?.schemas || {};

  let content = `/**
 * This file was automatically generated from the OpenAPI specification.
 * DO NOT EDIT DIRECTLY.
 */

`;

  Object.entries(schemas).forEach(([schemaName, schema]) => {
    const tsType = jsonSchemaToTypeScript(schema, schemas);
    if (schema.type === 'object') {
      content += `export interface ${schemaName} ${tsType}\n\n`;
    } else {
      content += `export type ${schemaName} = ${tsType};\n\n`;
    }
  });

  const file = path.join(typesDir, 'api-types.d.ts');
  fs.writeFileSync(file, content, 'utf8');
  console.log(`✓ Generated ${file}`);
};

function jsonSchemaToTypeScript(schema, allSchemas) {
  if (!schema) return 'any';

  let typeStr = 'any';
  if (schema.$ref) {
    typeStr = schema.$ref.split('/').pop();
  } else if (schema.enum) {
    typeStr = schema.enum.map(v => typeof v === 'string' ? `'${v}'` : v).join(' | ');
  } else if (schema.type === 'object') {
    const required = new Set(schema.required || []);
    let code = '{\n';
    if (schema.properties) {
      Object.entries(schema.properties).forEach(([propName, propSchema]) => {
        const isOptional = !required.has(propName);
        const propType = jsonSchemaToTypeScript(propSchema, allSchemas);
        // Indent lines of nested types
        const indentedPropType = propType.split('\n').map((line, idx) => idx > 0 ? '  ' + line : line).join('\n');
        code += `  ${propName}${isOptional ? '?' : ''}: ${indentedPropType};\n`;
      });
    } else {
      code += '  [key: string]: any;\n';
    }
    code += '}';
    typeStr = code;
  } else if (schema.type === 'array') {
    const itemType = jsonSchemaToTypeScript(schema.items || {}, allSchemas);
    const needsParentheses = itemType.includes('\n') || itemType.includes('|') || itemType.includes('&');
    typeStr = needsParentheses ? `(${itemType})[]` : `${itemType}[]`;
  } else if (schema.oneOf || schema.anyOf || schema.allOf) {
    const schemasList = schema.oneOf || schema.anyOf || schema.allOf;
    const delimiter = schema.allOf ? ' & ' : ' | ';
    typeStr = schemasList.map(s => {
      const sType = jsonSchemaToTypeScript(s, allSchemas);
      return sType.includes('\n') ? `(${sType})` : sType;
    }).join(delimiter);
  } else {
    switch (schema.type) {
      case 'string':
        typeStr = 'string';
        break;
      case 'number':
      case 'integer':
        typeStr = 'number';
        break;
      case 'boolean':
        typeStr = 'boolean';
        break;
      case 'null':
        typeStr = 'null';
        break;
      default:
        typeStr = 'any';
    }
  }

  if (schema.nullable) {
    typeStr = `(${typeStr}) | null`;
  }
  return typeStr;
}
