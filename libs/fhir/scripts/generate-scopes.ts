import fs from 'fs-extra';
import path from 'path';

const resources = [
  'Patient',
  'Observation',
  'Organization'
];

const OUTPUT_DIR = path.resolve(
  __dirname,
  '../src/generated/scopes/R4'
);

fs.ensureDirSync(OUTPUT_DIR);

for (const resource of resources) {

  const output = {
    resource,
    scopes: [
      `${resource.toLowerCase()}.read`,
      `${resource.toLowerCase()}.write`
    ]
  };

  const filePath = path.join(
    OUTPUT_DIR,
    `${resource}.scope.json`
  );

  fs.writeJsonSync(
    filePath,
    output,
    { spaces: 2 }
  );

  console.error(
    `Generated: ${filePath}`
  );
}