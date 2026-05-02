import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const SERVERLESS_PATH =
  process.env.SERVERLESS_FILE ||
  path.resolve(process.cwd(), 'apps/metadata-registry-service/serverless.yml');

const RENAME_FUNCTION_KEYS = true;

console.log('📂 Using serverless file:', SERVERLESS_PATH);

if (!fs.existsSync(SERVERLESS_PATH)) {
  console.error('❌ File not found:', SERVERLESS_PATH);
  process.exit(1);
}

const raw = fs.readFileSync(SERVERLESS_PATH, 'utf-8');
const doc: any = yaml.load(raw);

const updatedFunctions: Record<string, any> = {};

Object.entries(doc.functions || {}).forEach(([fnName, fnConfig]: any) => {
  if (!fnConfig.handler) {
    updatedFunctions[fnName] = fnConfig;
    return;
  }

  const handler: string = fnConfig.handler;

  console.log('🔍 Checking:', handler);

  if (handler.includes('src/handlers') && !handler.includes('/v1/')) {
    const newHandler = handler.replace(
      /src\/handlers\//,
      'src/handlers/v1/'
    );

    console.log(`🔁 ${handler} → ${newHandler}`);

    const newFnName = RENAME_FUNCTION_KEYS
      ? `${fnName}V1`
      : fnName;

    updatedFunctions[newFnName] = {
      ...fnConfig,
      handler: newHandler,
    };
  } else {
    updatedFunctions[fnName] = fnConfig;
  }
});

doc.functions = updatedFunctions;

fs.writeFileSync(SERVERLESS_PATH, yaml.dump(doc, { lineWidth: -1 }));

console.log('✅ Done updating serverless.yml');