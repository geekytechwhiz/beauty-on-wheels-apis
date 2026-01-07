#!/usr/bin/env node

import { Command } from 'commander';
import { registerGenerateCommand } from './commands/generate.js';
import { registerAnalyzeCommand } from './commands/analyze.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerInitCommand } from './commands/init.js';
import { registerFromServerlessCommand } from './commands/from-serverless.js';

const program = new Command();

program
  .name('fhir-mapper')
  .description('AI-powered CLI tool for generating FHIR response mapping code')
  .version('0.1.0');

registerGenerateCommand(program);
registerAnalyzeCommand(program);
registerValidateCommand(program);
registerInitCommand(program);
registerFromServerlessCommand(program);

program.parse();

