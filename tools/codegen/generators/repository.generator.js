const fs = require('fs');
const path = require('path');

module.exports = function generateRepositories(projectRoot, model) {
  const repositoryDir = path.join(projectRoot, 'src', 'repositories');

  fs.mkdirSync(repositoryDir, {
    recursive: true,
  });

  model.resources.forEach((resource) => {
    const file = path.join(repositoryDir, `${resource.fileName}.repository.ts`);

    fs.writeFileSync(file, render(resource), 'utf8');

    console.log(`✓ Repository ${resource.fileName}`);
  });
};

function render(resource) {
  return `import {
    BaseRepository
} from "@api-hub/utils";

import {
    env
} from "../configs/env.config";

export class ${resource.className}Repository
    extends BaseRepository {

    constructor() {
        super();
    }

    public getTableName() {
        return env.DYNAMODB_TABLE_NAME;
    }

}

let repository:
    ${resource.className}Repository;

export function get${resource.className}Repository() {

    if (!repository) {

        repository =
            new ${resource.className}Repository();

    }

    return repository;

}
`;
}
