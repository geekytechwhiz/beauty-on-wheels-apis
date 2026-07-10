/**
 * --------------------------------------------------------
 * Zod Type Builder
 *
 * Converts resolved OpenAPI schema
 * into Zod expressions.
 *
 * Supported
 *
 * ✔ string
 * ✔ number
 * ✔ integer
 * ✔ boolean
 * ✔ object
 * ✔ array
 * ✔ enum
 * ✔ nullable
 * ✔ optional
 * ✔ email
 * ✔ uuid
 * ✔ uri
 * ✔ minLength
 * ✔ maxLength
 * ✔ minimum
 * ✔ maximum
 *
 * --------------------------------------------------------
 */

class ZodTypeBuilder {
  build(schema, required = true) {
    if (!schema) {
      return 'z.any()';
    }

    let expression;

    switch (schema.type) {
      case 'string':
        expression = this.buildString(schema);
        break;

      case 'integer':
      case 'number':
        expression = this.buildNumber(schema);
        break;

      case 'boolean':
        expression = 'z.boolean()';
        break;

      case 'array':
        expression = this.buildArray(schema);
        break;

      case 'object':
        expression = this.buildObject(schema);
        break;

      default:
        expression = 'z.any()';
    }

    if (schema.nullable) {
      expression += '.nullable()';
    }

    if (!required) {
      expression += '.optional()';
    }

    return expression;
  }

  buildString(schema) {
    if (schema.enum) {
      return `z.enum([${schema.enum.map((v) => `"${v}"`).join(', ')}])`;
    }

    let zod = 'z.string()';

    switch (schema.format) {
      case 'email':
        zod += '.email()';
        break;

      case 'uuid':
        zod += '.uuid()';
        break;

      case 'uri':
      case 'url':
        zod += '.url()';
        break;

      case 'date-time':
        zod += '.datetime()';
        break;
    }

    if (schema.minLength !== undefined) {
      zod += `.min(${schema.minLength})`;
    }

    if (schema.maxLength !== undefined) {
      zod += `.max(${schema.maxLength})`;
    }

    if (schema.pattern) {
      zod += `.regex(new RegExp(${JSON.stringify(schema.pattern)}))`;
    }

    return zod;
  }

  buildNumber(schema) {
    let zod = 'z.number()';

    if (schema.minimum !== undefined) {
      zod += `.min(${schema.minimum})`;
    }

    if (schema.maximum !== undefined) {
      zod += `.max(${schema.maximum})`;
    }

    if (schema.type === 'integer') {
      zod += '.int()';
    }

    return zod;
  }

  buildArray(schema) {
    const itemType = this.build(schema.items);

    return `z.array(${itemType})`;
  }

  buildObject(schema) {
    const requiredFields = schema.required || [];

    const fields = [];

    Object.entries(schema.properties || {}).forEach(([name, property]) => {
      fields.push(
        `${name}: ${this.build(property, requiredFields.includes(name))}`,
      );
    });

    return `z.object({
${fields.join(',\n')}
})`;
  }
}

module.exports = ZodTypeBuilder;
