const SchemaResolver = require('./schema-resolver');
const ZodTypeBuilder = require('./zod-type-builder');

class SchemaRenderer {
  constructor(openApi) {
    this.resolver = new SchemaResolver(openApi);
    this.builder = new ZodTypeBuilder();
  }

  /**
   * Generate complete schema file
   */
  render(resource) {
    const renderedSchemas = new Set();
    const schemas = [];

    for (const op of resource.operations) {
      if (op.request && op.request.name) {
        const schemaName = op.request.name;
        if (!renderedSchemas.has(schemaName)) {
          renderedSchemas.add(schemaName);
          schemas.push(this.renderRequest(op));
        }
      }
    }

    if (schemas.length === 0) {
      return `// No request schemas to validate
export {};
`;
    }

    const imports = this.renderImports();

    return `${imports}

${schemas.join('\n\n')}
`;
  }

  renderImports() {
    return `import { z } from "zod";
import { LambdaRequest } from "@api-hub/utils";
import { EventSchemaError } from "@api-hub/middleware";`;
  }

  renderRequest(operation) {
    const requestName = operation.request.name;
    const resolved = this.resolver.resolve(requestName);
    const zod = this.builder.build(resolved);

    return `/**
 * ---------------------------------------------------------
 * ${requestName}
 * ---------------------------------------------------------
 */

export const ${requestName}Schema = ${zod}.strict();

export type ${requestName} =
    z.infer<typeof ${requestName}Schema>;

export const validate${requestName} = (req: LambdaRequest): ${requestName} => {
    const result = ${requestName}Schema.safeParse(req.body);
    if (!result.success) {
        throw new EventSchemaError("Request validation failed", result.error);
    }
    return result.data;
};`;
  }
}

module.exports = SchemaRenderer;
