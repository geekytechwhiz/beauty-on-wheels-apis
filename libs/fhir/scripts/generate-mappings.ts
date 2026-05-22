import fs from 'fs-extra';
import path from 'path';
import { globSync } from 'glob';

const metadataPath = path.join(__dirname, '../src/generated/resources/R4');
const templatesOutputPath = path.join(__dirname, '../src/generated/templates/R4');
const curatedMappingsPath = path.join(__dirname, '../src/mappings/R4');

function toMappingTarget(resource: string, fhirPath: string): string {
  if (fhirPath === resource) {
    return '';
  }

  const prefix = `${resource}.`;

  return fhirPath.startsWith(prefix)
    ? fhirPath.slice(prefix.length)
    : fhirPath;
}

fs.ensureDirSync(templatesOutputPath);

const files = globSync(`${metadataPath}/*.metadata.json`);

let generated = 0;
let skippedCurated = 0;

for (const file of files) {
  const metadata = fs.readJSONSync(file);
  const curatedMappingPath = path.join(
    curatedMappingsPath,
    `${metadata.resource}.mapping.json`,
  );

  if (fs.existsSync(curatedMappingPath)) {
    skippedCurated += 1;
    console.error(
      `Skipped template for ${metadata.resource}: curated mapping exists at mappings/R4/${metadata.resource}.mapping.json`,
    );
    continue;
  }

  const output = {
    resource: metadata.resource,
    version: metadata.version,
    fields: metadata.fields
      .map((field: { path: string; type: string[] }) => ({
        source: '',
        target: toMappingTarget(metadata.resource, field.path),
        fieldType: field.type[0],
      }))
      .filter((field: { target: string }) => field.target !== ''),
  };

  fs.writeJsonSync(
    path.join(
      templatesOutputPath,
      `${metadata.resource}.mapping.template.json`,
    ),
    output,
    { spaces: 2 },
  );

  generated += 1;
  console.error(`Generated template for ${metadata.resource}`);
}

console.error(
  `Done: ${generated} template(s) written, ${skippedCurated} skipped (curated mapping present).`,
);
