import { Command } from 'commander';
import { ServerlessParser, type ServerlessFunction } from '../core/serverless-parser.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export function registerFromServerlessCommand(program: Command) {
  program
    .command('from-serverless')
    .alias('from-sls')
    .description('Generate FHIR mapping configuration from serverless.yml')
    .requiredOption('-s, --serverless <path>', 'Path to serverless.yml file')
    .option('-f, --function <name>', 'Specific function name to extract (optional)')
    .option('-o, --output <path>', 'Output configuration file path (or directory if --all)')
    .option('--all', 'Generate configurations for all GET functions')
    .option('--interactive', 'Interactive mode to select function and configure')
    .action(async (options: {
      serverless: string;
      function?: string;
      output?: string;
      all?: boolean;
      interactive?: boolean;
    }) => {
      try {
        // console.log(`📋 Parsing serverless.yml: ${options.serverless}`);
        
        const parser = new ServerlessParser();
        const serverlessConfig = parser.parseServerlessFile(options.serverless);
        const getFunctions = parser.extractGetFunctions(serverlessConfig);

        if (getFunctions.length === 0) {
          console.warn('⚠️  No GET functions with path parameters found in serverless.yml');
          // console.log('   Functions need to have HTTP GET events with path parameters (e.g., /user/{userId})');
          process.exit(0);
        }

        // console.log(`\n📊 Found ${getFunctions.length} GET function(s) with path parameters:\n`);

        // Display available functions
        getFunctions.forEach((func, index) => {
          // console.log(`${index + 1}. ${func.name}`);
          // console.log(`   Path: ${func.path}`);
          // console.log(`   Handler: ${func.handler}`);
          if (func.pathParameters?.length) {
            // console.log(`   Parameters: ${func.pathParameters.map(p => p.name).join(', ')}`);
          }
          // console.log('');
        });

        // Handle --all option: generate configs for all functions
        if (options.all) {
          await generateAllConfigurations(
            parser,
            serverlessConfig,
            getFunctions,
            options.serverless,
            options.output
          );
          return;
        }

        // Select function
        let selectedFunction: ServerlessFunction | undefined;
        
        if (options.function) {
          selectedFunction = getFunctions.find(f => f.name === options.function);
          if (!selectedFunction) {
            console.error(`❌ Function "${options.function}" not found`);
            process.exit(1);
          }
        } else if (options.interactive) {
          // In interactive mode, prompt for selection
          const { default: inquirer } = await import('inquirer');
          const answer = await inquirer.prompt([
            {
              type: 'list',
              name: 'functionName',
              message: 'Select a function to generate configuration for:',
              choices: getFunctions.map(f => ({
                name: `${f.name} (${f.path})`,
                value: f.name,
              })),
            },
          ]);
          selectedFunction = getFunctions.find(f => f.name === answer.functionName);
        } else {
          // Use first function by default
          selectedFunction = getFunctions[0];
          // console.log(`\n✅ Using first function: ${selectedFunction.name}`);
        }

        if (!selectedFunction) {
          console.error('❌ No function selected');
          process.exit(1);
        }

        // Generate single configuration
        await generateSingleConfiguration(
          parser,
          serverlessConfig,
          selectedFunction,
          options.serverless,
          options.output
        );
      } catch (error) {
        console.error('❌ Error generating configuration:', error);
        if (error instanceof Error) {
          console.error('   ', error.message);
        }
        process.exit(1);
      }
    });
}

/**
 * Generate configuration for a single function
 */
async function generateSingleConfiguration(
  parser: ServerlessParser,
  serverlessConfig: any,
  selectedFunction: ServerlessFunction,
  serverlessPath: string,
  outputPath?: string
): Promise<void> {
  // Infer FHIR resource details
  const fhirInfo = parser.inferFhirResourceType(
    selectedFunction.name,
    selectedFunction.path || ''
  );
  const serviceName = parser.generateServiceName(serverlessConfig.service);
  const apiEndpoint = parser.inferApiEndpoint(
    selectedFunction.path || '',
    serviceName
  );

  // Generate configuration
  const config = {
    service: {
      name: serviceName,
      baseUrl: `\${env:${serviceName.toUpperCase().replace(/-/g, '_')}_SERVICE_URL, 'http://localhost:3000'}`,
      apiEndpoint: apiEndpoint,
      method: 'GET',
      authRequired: true,
      responseType: `${fhirInfo.resourceType}DTO`,
      ...(selectedFunction.queryParameters && selectedFunction.queryParameters.length > 0 && {
        queryParameters: selectedFunction.queryParameters.map((p: { name: string; type?: string; optional?: boolean; description?: string }) => ({
          name: p.name,
          type: p.type || 'string',
          optional: p.optional !== false,
          description: p.description,
        })),
      }),
    },
    fhirResource: {
      resourceType: fhirInfo.resourceType,
      category: fhirInfo.category,
      path: fhirInfo.path,
    },
    mappings: [
      {
        source: selectedFunction.pathParameters?.[0]?.name || 'id',
        target: 'id',
        transformation: `dto.${selectedFunction.pathParameters?.[0]?.name || 'id'}`,
        description: 'Resource ID mapping',
      },
    ],
    generation: {
      generateFiles: ['service-client', 'adapter', 'handler'],
      options: {
        addComments: true,
        addJSDoc: true,
        includeValidation: true,
        formatCode: true,
      },
    },
  };

  // Convert to YAML
  const { stringify } = await import('yaml');
  const yamlContent = `# FHIR Mapping Configuration
# Generated from serverless.yml: ${serverlessPath}
# Function: ${selectedFunction.name}
# Path: ${selectedFunction.path}
# 
# ⚠️  This is a template - you need to:
# 1. Update the apiEndpoint to match your actual microservice endpoint
# 2. Add field mappings based on your API response structure
# 3. Add custom transformations if needed
# 4. Review and adjust FHIR resource type if needed

${stringify(config)}`;

  // Write output
  const finalOutputPath = outputPath || `${serviceName}-mapping.yaml`;
  writeFileSync(finalOutputPath, yamlContent, 'utf-8');

  // console.log(`\n✅ Configuration generated: ${finalOutputPath}`);
  // console.log('\n📝 Next steps:');
  // console.log('   1. Review the generated configuration');
  // console.log('   2. Update apiEndpoint to match your microservice API');
  // console.log('   3. Add field mappings based on your API response');
  // console.log(`   4. Run: fhir-mapper generate -c ${finalOutputPath}`);
}

/**
 * Generate configurations for all functions
 */
async function generateAllConfigurations(
  parser: ServerlessParser,
  serverlessConfig: any,
  functions: ServerlessFunction[],
  serverlessPath: string,
  outputDir?: string
): Promise<void> {
  const serviceName = parser.generateServiceName(serverlessConfig.service);
  
  // Determine output directory
  const outputDirectory = outputDir || `${serviceName}-configs`;
  
  // Create output directory if it doesn't exist
  if (!existsSync(outputDirectory)) {
    mkdirSync(outputDirectory, { recursive: true });
  }

  // console.log(`\n🔨 Generating configurations for ${functions.length} function(s)...\n`);

  const { stringify } = await import('yaml');
  const generatedFiles: string[] = [];

  for (const func of functions) {
    // Infer FHIR resource details
    const fhirInfo = parser.inferFhirResourceType(func.name, func.path || '');
    const apiEndpoint = parser.inferApiEndpoint(func.path || '', serviceName);

    // Generate configuration
    const config = {
      service: {
        name: serviceName,
        baseUrl: `\${env:${serviceName.toUpperCase().replace(/-/g, '_')}_SERVICE_URL, 'http://localhost:3000'}`,
        apiEndpoint: apiEndpoint,
        method: 'GET',
        authRequired: true,
        responseType: `${fhirInfo.resourceType}DTO`,
        ...(func.queryParameters && func.queryParameters.length > 0 && {
          queryParameters: func.queryParameters.map((p: { name: string; type?: string; optional?: boolean; description?: string }) => ({
            name: p.name,
            type: p.type || 'string',
            optional: p.optional !== false,
            description: p.description,
          })),
        }),
      },
      fhirResource: {
        resourceType: fhirInfo.resourceType,
        category: fhirInfo.category,
        path: fhirInfo.path,
      },
      mappings: [
        {
          source: func.pathParameters?.[0]?.name || 'id',
          target: 'id',
          transformation: `dto.${func.pathParameters?.[0]?.name || 'id'}`,
          description: 'Resource ID mapping',
        },
      ],
      generation: {
        generateFiles: ['service-client', 'adapter', 'handler'],
        options: {
          addComments: true,
          addJSDoc: true,
          includeValidation: true,
          formatCode: true,
        },
      },
    };

    const yamlContent = `# FHIR Mapping Configuration
# Generated from serverless.yml: ${serverlessPath}
# Function: ${func.name}
# Path: ${func.path}
# 
# ⚠️  This is a template - you need to:
# 1. Update the apiEndpoint to match your actual microservice endpoint
# 2. Add field mappings based on your API response structure
# 3. Add custom transformations if needed
# 4. Review and adjust FHIR resource type if needed

${stringify(config)}`;

    // Generate filename from function name
    const fileName = `${func.name}-mapping.yaml`;
    const filePath = join(outputDirectory, fileName);
    writeFileSync(filePath, yamlContent, 'utf-8');
    generatedFiles.push(filePath);

    // console.log(`   ✅ ${func.name} → ${filePath}`);
  }

  // console.log(`\n✅ Generated ${generatedFiles.length} configuration file(s) in: ${outputDirectory}`);
  // console.log('\n📝 Next steps:');
  // console.log('   1. Review each configuration file');
  // console.log('   2. Update apiEndpoint for each to match your microservice API');
  // console.log('   3. Add field mappings based on your API response structure');
  // console.log('   4. Generate code for each:');
  generatedFiles.forEach((file) => {
    // console.log(`      fhir-mapper generate -c ${file}`);
  });
}

