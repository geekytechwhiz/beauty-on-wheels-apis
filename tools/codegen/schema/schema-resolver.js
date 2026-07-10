const path = require('path');

/**
 * --------------------------------------------------------
 * Schema Resolver
 *
 * Resolves OpenAPI schemas.
 *
 * Supports
 *
 * ✔ $ref
 * ✔ object
 * ✔ array
 * ✔ enum
 * ✔ nested object
 * ✔ nested $ref
 * ✔ nullable
 *
 * --------------------------------------------------------
 */

class SchemaResolver {
  constructor(openApi) {
    this.document = openApi;

    this.schemas = openApi.components?.schemas || {};
  }

  /**
   * ----------------------------------------------------
   * Resolve schema by name
   * ----------------------------------------------------
   */

  resolve(name) {
    if (!this.schemas[name]) {
      throw new Error(`Schema '${name}' not found.`);
    }

    return this.resolveSchema(this.schemas[name], new Set());
  }

  /**
   * ----------------------------------------------------
   */

  resolveSchema(schema, visited) {
    if (!schema) {
      return null;
    }

    /**
     * Circular reference protection
     */

    if (schema.$ref) {
      const refName = this.getRefName(schema.$ref);

      if (visited.has(refName)) {
        return {
          type: 'object',

          circular: true,

          ref: refName,
        };
      }

      visited.add(refName);

      return this.resolveSchema(
        this.schemas[refName],

        visited,
      );
    }

    /**
     * Object
     */

    if (schema.type === 'object') {
      return {
        type: 'object',

        required: schema.required || [],

        properties: this.resolveProperties(
          schema.properties || {},

          visited,
        ),
      };
    }

    /**
     * Array
     */

    if (schema.type === 'array') {
      return {
        type: 'array',

        items: this.resolveSchema(
          schema.items,

          visited,
        ),
      };
    }

    /**
     * Enum
     */

    if (schema.enum) {
      return {
        type: schema.type,

        enum: schema.enum,
      };
    }

    /**
     * Primitive
     */

    return {
      type: schema.type,

      format: schema.format,

      nullable: schema.nullable || false,

      minimum: schema.minimum,

      maximum: schema.maximum,

      minLength: schema.minLength,

      maxLength: schema.maxLength,

      pattern: schema.pattern,

      description: schema.description,

      example: schema.example,

      default: schema.default,
    };
  }

  /**
   * ----------------------------------------------------
   */

  resolveProperties(
    properties,

    visited,
  ) {
    const result = {};

    Object.entries(properties)

      .forEach(([key, value]) => {
        result[key] = this.resolveSchema(
          value,

          new Set(visited),
        );
      });

    return result;
  }

  /**
   * ----------------------------------------------------
   */

  getRefName(ref) {
    return ref.split('/').pop();
  }
}

module.exports = SchemaResolver;
