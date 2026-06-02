import fs from 'fs-extra';
import path from 'path';
import { globSync } from 'glob';

const packagePath = path.join(__dirname, '../src/package/r4');
const outputPath = path.join(__dirname, '../src/generated/resources/R4');

async function generate() {
  const files = globSync(`${packagePath}/StructureDefinition-*.json`);

  for (const file of files) {
    const resource = await fs.readJSON(file);

    if (resource.kind !== 'resource') continue;

    const output = {
      resource: resource.name,

      version: resource.fhirVersion,

      fields: resource.snapshot.element.map((el: any) => ({
        path: el.path,

        type: el.type?.map((t: any) => t.code) || [],

        required: el.min > 0,

        multiple: el.max === '*',
      })),
    };

    await fs.ensureDir(outputPath);

    await fs.writeJson(`${outputPath}/${resource.name}.metadata.json`, output, {
      spaces: 2,
    });

    console.error(`Generated ${resource.name}`);
  }
}

generate();
