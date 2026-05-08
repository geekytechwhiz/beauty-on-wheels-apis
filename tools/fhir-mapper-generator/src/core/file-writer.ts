import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import prettier from 'prettier';
import * as ts from 'typescript';

export interface FileWriterOptions {
  format?: boolean;
  validate?: boolean;
  prettierConfig?: prettier.Options;
}

export class FileWriter {
  private options: Required<FileWriterOptions>;

  constructor(options: FileWriterOptions = {}) {
    this.options = {
      format: options.format !== false,
      validate: options.validate !== false,
      prettierConfig: options.prettierConfig || {
        parser: 'typescript',
        singleQuote: true,
        trailingComma: 'es5',
        tabWidth: 2,
        printWidth: 100,
        semi: false,
      },
    };
  }

  /**
   * Write formatted TypeScript file
   */
  async writeFile(
    filePath: string,
    content: string,
    options: { format?: boolean; validate?: boolean } = {}
  ): Promise<void> {
    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    let formattedContent = content;

    // Format code if requested
    if (options.format !== false && this.options.format) {
      try {
        formattedContent = await prettier.format(content, this.options.prettierConfig);
      } catch (error) {
        console.warn(`Failed to format ${filePath}:`, error);
        formattedContent = content;
      }
    }

    // Validate TypeScript if requested
    if (options.validate !== false && this.options.validate) {
      const validationResult = this.validateTypeScript(formattedContent, filePath);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        console.warn(`TypeScript validation warnings for ${filePath}:`);
        validationResult.errors.forEach((error) => console.warn(`  - ${error}`));
        // Don't throw - just warn, as generated code might need manual fixes
      }
    }

    writeFileSync(filePath, formattedContent, 'utf-8');
  }

  /**
   * Validate TypeScript code
   */
  private validateTypeScript(
    sourceCode: string,
    fileName: string
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      const result = ts.transpileModule(sourceCode, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          strict: true,
          noImplicitAny: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        fileName,
      });

      if (result.diagnostics && result.diagnostics.length > 0) {
        result.diagnostics.forEach((diagnostic) => {
          const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
          errors.push(message);
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        errors.push(error.message);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Update serverless.yml with new function configuration
   * Note: This is a simplified implementation. Full version would use YAML parser
   */
  async updateServerlessConfig(
    serverlessPath: string,
    newFunction: {
      name: string;
      handler: string;
      path: string;
      method?: string;
    }
  ): Promise<void> {
    // This would require a YAML parser to properly update the file
    // For now, we'll just log what needs to be added
    // console.log(`\n📝 Update ${serverlessPath} with:`);
    // console.log(`functions:`);
    // console.log(`  ${newFunction.name}:`);
    // console.log(`    handler: ${newFunction.handler}`);
    // console.log(`    timeout: 10`);
    // console.log(`    memorySize: 256`);
    // console.log(`    events:`);
    // console.log(`      - http:`);
    // console.log(`          path: ${newFunction.path}`);
    // console.log(`          method: ${newFunction.method || 'get'}`);
  }

  /**
   * Update TypeScript index.ts with new exports
   * Note: This is a simplified implementation. Full version would use AST manipulation
   */
  async updateIndexExports(
    indexPath: string,
    newExports: string[]
  ): Promise<void> {
    // This would require AST manipulation to properly update the file
    // For now, we'll just log what needs to be added
    // console.log(`\n📝 Add to ${indexPath}:`);
    newExports.forEach((exportStatement) => {
      // console.log(`  ${exportStatement}`);
    });
  }
}

