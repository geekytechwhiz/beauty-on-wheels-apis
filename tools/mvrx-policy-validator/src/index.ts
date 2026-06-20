import { validateWorkspace } from './validator.js';

const args = process.argv.slice(2);
const onlyChanged = args.includes('--only-changed');
const files = args.filter((arg) => arg !== '--only-changed');

validateWorkspace(files.length > 0 ? files : undefined, onlyChanged);