import { Command } from 'commander';
import { PatternAnalyzer, MappingPattern } from '../core/pattern-analyzer.js';

export function registerAnalyzeCommand(program: Command) {
  program
    .command('analyze')
    .description('Analyze existing adapter patterns in the codebase')
    .option('-o, --output <path>', 'Output file for analysis results (JSON)')
    .option('--verbose', 'Verbose output')
    .action(async (options: { output?: string; verbose?: boolean }) => {
      try {
        // console.log('🔍 Analyzing existing adapter patterns...');
        
        const analyzer = new PatternAnalyzer();
        const patternsPromise = analyzer.analyzeExistingAdapters();
        const patterns = await patternsPromise;

        // console.log(`\n📊 Found ${patterns.length} mapping patterns`);

        if (options.verbose) {
          // console.log('\nPatterns:');
          patterns.forEach((pattern: MappingPattern, index: number) => {
            // console.log(`\n${index + 1}. ${pattern.sourceField} → ${pattern.targetField}`);
            if (pattern.transformation) {
              // console.log(`   Transformation: ${pattern.transformation}`);
            }
            if (pattern.utilityFunctions?.length) {
              // console.log(`   Utilities: ${pattern.utilityFunctions.join(', ')}`);
            }
          });
        }

        if (options.output) {
          const { writeFileSync } = await import('fs');
          writeFileSync(options.output, JSON.stringify(patterns, null, 2));
          // console.log(`\n✅ Analysis results saved to: ${options.output}`);
        }
      } catch (error) {
        console.error('❌ Error analyzing patterns:', error);
        if (error instanceof Error) {
          console.error('   ', error.message);
        }
        process.exit(1);
      }
    });
}

