import { Command } from 'commander';
import { ConfigParser } from '../core/config-parser.js';
import { CodeGenerator } from '../core/code-generator.js';
import { FileWriter } from '../core/file-writer.js';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

export function registerGenerateCommand(program: Command) {
  program
    .command('generate')
    .alias('gen')
    .description('Generate FHIR mapping code from configuration')
    .requiredOption('-c, --config <path>', 'Path to mapping configuration file (YAML/JSON)')
    .option('-o, --output <path>', 'Output directory (default: workspace root)')
    .option('--dry-run', 'Preview generated code without writing files')
    .option('--no-format', 'Skip code formatting')
    .option('--no-validate', 'Skip TypeScript validation')
    .option('--interactive', 'Interactive mode for configuration')
    .option('--ai-model <model>', 'AI model to use (gpt-4, gpt-3.5-turbo, claude-3-opus)')
    .option('--no-ai', 'Use rule-based mapping only (no AI)')
    .option('--verbose', 'Verbose output')
    .action(async (options: {
      config: string;
      output?: string;
      dryRun?: boolean;
      format?: boolean;
      validate?: boolean;
      interactive?: boolean;
      aiModel?: string;
      ai?: boolean;
      verbose?: boolean;
    }) => {
      try {
        const configParser = new ConfigParser();
        const config = configParser.parseConfig(options.config);

        // Detect workspace root (look for nx.json at root level, not in subdirectories)
        const findWorkspaceRoot = (startPath: string): string => {
          let current = resolve(startPath);
          const root = resolve('/');
          
          // Go up until we find nx.json at root level
          while (current !== root) {
            // Check for nx.json (definitive marker of workspace root)
            if (existsSync(join(current, 'nx.json'))) {
              // Also verify apps/ exists to ensure it's the right root
              if (existsSync(join(current, 'apps'))) {
                return current;
              }
            }
            const parent = resolve(current, '..');
            if (parent === current) break; // Reached filesystem root
            current = parent;
          }
          
          // Fallback: if we're in tools/fhir-mapper-generator, go up two levels
          if (process.cwd().includes('tools/fhir-mapper-generator')) {
            const potentialRoot = resolve(process.cwd(), '../..');
            if (existsSync(join(potentialRoot, 'nx.json')) && existsSync(join(potentialRoot, 'apps'))) {
              return potentialRoot;
            }
          }
          
          return process.cwd(); // Final fallback
        };

        const workspaceRoot = findWorkspaceRoot(process.cwd());
        const outputDir = options.output ? resolve(options.output) : workspaceRoot;
        
        if (options.verbose) {
          console.log(`📁 Workspace root: ${workspaceRoot}`);
          console.log(`📁 Output directory: ${outputDir}`);
        }
        // CodeGenerator will auto-detect template directory
        const codeGenerator = new CodeGenerator();
        const fileWriter = new FileWriter({
          format: options.format !== false,
          validate: options.validate !== false,
        });

        console.log('📋 Configuration loaded successfully');
        console.log(`   Service: ${config.service.name}`);
        console.log(`   FHIR Resource: ${config.fhirResource.resourceType}`);

        // Generate service client
        if (config.generation?.generateFiles?.includes('service-client') !== false) {
          console.log('\n🔨 Generating service client...');
          const serviceClientCode = codeGenerator.generateServiceClient(config);
          
          if (options.dryRun) {
            console.log('\n=== Service Client ===');
            console.log(serviceClientCode);
          } else {
            const serviceClientPath = join(
              outputDir,
              `apps/fhir-gateway/src/services/${config.service.name}.client.ts`
            );
            await fileWriter.writeFile(serviceClientPath, serviceClientCode);
            console.log(`   ✅ Generated: ${serviceClientPath}`);
          }
        }

        // Generate adapter
        if (config.generation?.generateFiles?.includes('adapter') !== false) {
          console.log('\n🔨 Generating adapter...');
          const adapterCode = codeGenerator.generateAdapter(config);
          
          if (options.dryRun) {
            console.log('\n=== Adapter ===');
            console.log(adapterCode);
          } else {
            const category = config.fhirResource.category || 'identity';
            const resourceName = config.fhirResource.resourceType.toLowerCase();
            const adapterPath = join(
              outputDir,
              `libs/fhir/src/adapters/${category}/${resourceName}.adapter.ts`
            );
            await fileWriter.writeFile(adapterPath, adapterCode);
            console.log(`   ✅ Generated: ${adapterPath}`);
          }
        }

        // Generate handler
        if (config.generation?.generateFiles?.includes('handler') !== false) {
          console.log('\n🔨 Generating handler...');
          const handlerCode = codeGenerator.generateHandler(config);
          
          if (options.dryRun) {
            console.log('\n=== Handler ===');
            console.log(handlerCode);
          } else {
            const resourceName = config.fhirResource.resourceType.toLowerCase();
            const handlerPath = join(
              outputDir,
              `apps/fhir-gateway/src/handlers/${resourceName}.ts`
            );
            await fileWriter.writeFile(handlerPath, handlerCode);
            console.log(`   ✅ Generated: ${handlerPath}`);
          }
        }

        if (!options.dryRun) {
          console.log('\n✅ Code generation completed successfully!');
          console.log('\n📝 Next steps:');
          console.log('   1. Review the generated code');
          console.log('   2. Update serverless.yml with the new function');
          console.log('   3. Update index.ts files with new exports');
          console.log('   4. Run TypeScript compilation to verify');
        }
      } catch (error) {
        console.error('❌ Error generating code:', error);
        if (error instanceof Error) {
          console.error('   ', error.message);
        }
        process.exit(1);
      }
    });
}

