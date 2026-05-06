/* eslint-disable no-warning-comments */
import { Command } from 'commander';
import { ConfigParser } from '../core/config-parser.js';
import { readFileSync } from 'fs';
import * as ts from 'typescript';

export function registerValidateCommand(program: Command) {
  program
    .command('validate')
    .description('Validate configuration file or generated code')
    .option('-c, --config <path>', 'Validate configuration file')
    .option('-f, --file <path>', 'Validate generated TypeScript file')
    .action(async (options: { config?: string; file?: string }) => {
      try {
        if (options.config) {
          // console.log(`📋 Validating configuration: ${options.config}`);
          const configParser = new ConfigParser();
          const config = configParser.parseConfig(options.config);
          // console.log('✅ Configuration is valid');
          // console.log(`   Service: ${config.service.name}`);
          // console.log(`   FHIR Resource: ${config.fhirResource.resourceType}`);
          // console.log(`   Mappings: ${config.mappings.length}`);
        } else if (options.file) {
          // console.log(`🔍 Validating TypeScript file: ${options.file}`);
          const sourceCode = readFileSync(options.file, 'utf-8');
          
          const result = ts.transpileModule(sourceCode, {
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ESNext,
              strict: true,
              noImplicitAny: true,
            },
          });

          if (result.diagnostics && result.diagnostics.length > 0) {
            console.error('❌ TypeScript validation errors:');
            result.diagnostics.forEach((diagnostic) => {
              const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
              console.error(`   ${message}`);
            });
            process.exit(1);
          } else {
            // console.log('✅ TypeScript file is valid');
          }
        } else {
          console.error('❌ Please specify either --config or --file');
          process.exit(1);
        }
      } catch (error) {
        console.error('❌ Validation failed:', error);
        if (error instanceof Error) {
          console.error('   ', error.message);
        }
        process.exit(1);
      }
    });
}

