import { readFileSync } from 'fs';
import { glob } from 'glob';
import { join } from 'path';

export interface MappingPattern {
  sourceField: string;
  targetField: string;
  transformation?: string;
  utilityFunctions: string[];
  conditionalLogic?: string;
  patternType:
    | 'direct'
    | 'transformed'
    | 'codeableConcept'
    | 'reference'
    | 'array'
    | 'composite'
    | 'conditional'
    | 'date';
  example?: string;
}

export class PatternAnalyzer {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot || process.cwd();
  }

  /**
   * Analyze existing adapters in libs/fhir/src/adapters
   * Searches for all .adapter.ts files recursively
   */
  async analyzeExistingAdapters(): Promise<MappingPattern[]> {
    const adapterPattern = join(
      this.workspaceRoot,
      'libs/fhir/src/adapters/**/*.adapter.ts'
    );
    const adapterFiles = await glob(adapterPattern);
    const patterns: MappingPattern[] = [];

    for (const file of adapterFiles) {
      try {
        const sourceCode = readFileSync(file, 'utf-8');
        const patternsInFile = this.extractPatternsFromSource(sourceCode);
        patterns.push(...patternsInFile);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        console.warn(`Failed to analyze ${file}:`, errorMessage);
      }
    }

    return patterns;
  }

  /**
   * Find similar patterns for a given field
   */
  async findSimilarPatterns(
    fieldName: string,
    _fieldType: string,
    targetFhirField: string
  ): Promise<MappingPattern[]> {
    // This is a simplified implementation
    // In a full implementation, you'd use semantic similarity or more sophisticated matching
    const allPatterns = await this.analyzeExistingAdapters();

    return allPatterns.filter((pattern: MappingPattern) => {
      // Simple string matching - can be enhanced with semantic similarity
      const fieldLower = fieldName.toLowerCase();
      const patternLower = pattern.sourceField.toLowerCase();

      return (
        patternLower.includes(fieldLower) ||
        fieldLower.includes(patternLower) ||
        pattern.targetField === targetFhirField
      );
    });
  }

  /**
   * Extract patterns from TypeScript source code using regex
   * Note: Full implementation would use AST parsing for better accuracy
   */
  private extractPatternsFromSource(sourceCode: string): MappingPattern[] {
    const patterns: MappingPattern[] = [];

    // Pattern 1: Direct mappings (dto.field → resource.field)
    const directMappingRegex = /(\w+):\s*dto\.(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = directMappingRegex.exec(sourceCode)) !== null) {
      if (match[1] && match[2]) {
        patterns.push({
          sourceField: match[2],
          targetField: match[1],
          transformation: `dto.${match[2]}`,
          utilityFunctions: [],
          patternType: 'direct',
          example: match[0],
        });
      }
    }

    // Pattern 2: Transformed mappings (mapGender, etc.)
    const transformedMappingRegex = /(\w+):\s*map(\w+)\(dto\.(\w+)\)/g;
    while ((match = transformedMappingRegex.exec(sourceCode)) !== null) {
      if (match[1] && match[2] && match[3]) {
        patterns.push({
          sourceField: match[3],
          targetField: match[1],
          transformation: `map${match[2]}(dto.${match[3]})`,
          utilityFunctions: [],
          patternType: 'transformed',
          example: match[0],
        });
      }
    }

    // Pattern 3: CodeableConcept mappings
    const codeableConceptRegex = /createCodeableConcept\([^)]+\)/g;
    while ((match = codeableConceptRegex.exec(sourceCode)) !== null) {
      if (match[0]) {
        patterns.push({
          sourceField: 'code',
          targetField: 'code',
          transformation: match[0],
          utilityFunctions: ['createCodeableConcept'],
          patternType: 'codeableConcept',
          example: match[0],
        });
      }
    }

    // Pattern 4: Reference mappings
    const referenceRegex = /create(\w+)Reference\([^)]+\)/g;
    while ((match = referenceRegex.exec(sourceCode)) !== null) {
      if (match[0] && match[1]) {
        patterns.push({
          sourceField: 'id',
          targetField: 'reference',
          transformation: match[0],
          utilityFunctions: [`create${match[1]}Reference`],
          patternType: 'reference',
          example: match[0],
        });
      }
    }

    // Pattern 5: Date transformations
    const dateRegex = /(toFhirDate|toFhirDateTime)\(dto\.(\w+)\)/g;
    while ((match = dateRegex.exec(sourceCode)) !== null) {
      if (match[1] && match[2]) {
        patterns.push({
          sourceField: match[2],
          targetField: 'date',
          transformation: `${match[1]}(dto.${match[2]})`,
          utilityFunctions: [match[1]],
          patternType: 'date',
          example: match[0],
        });
      }
    }

    // Pattern 6: Conditional mappings
    const conditionalRegex = /\.\.\.\((\w+)\.(\w+)\s*&&\s*\{[^}]+\}\)/g;
    while ((match = conditionalRegex.exec(sourceCode)) !== null) {
      if (match[1] && match[2]) {
        patterns.push({
          sourceField: match[2],
          targetField: 'field',
          conditionalLogic: `${match[1]}.${match[2]}`,
          utilityFunctions: [],
          patternType: 'conditional',
          example: match[0],
        });
      }
    }

    // Pattern 7: Array mappings
    const arrayRegex = /(\w+):\s*(\w+)\.map\([^)]+\)/g;
    while ((match = arrayRegex.exec(sourceCode)) !== null) {
      if (match[1] && match[2]) {
        patterns.push({
          sourceField: match[2],
          targetField: match[1],
          transformation: match[0],
          utilityFunctions: [],
          patternType: 'array',
          example: match[0],
        });
      }
    }

    return patterns;
  }

  /**
   * Get utility functions used in a file
   */
  getUtilityFunctions(sourceCode: string): string[] {
    const utilityFunctions: readonly string[] = [
      'createCodeableConcept',
      'createCoding',
      'createReference',
      'createPatientReference',
      'createOrganizationReference',
      'createPractitionerReference',
      'toFhirDate',
      'toFhirDateTime',
      'getCurrentFhirDate',
      'getCurrentFhirDateTime',
    ];

    return utilityFunctions.filter((func: string): boolean => {
      const regex = new RegExp(`\\b${func}\\b`);
      return regex.test(sourceCode);
    });
  }
}
