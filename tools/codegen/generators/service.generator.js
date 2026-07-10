const fs = require('fs');
const path = require('path');

module.exports = function generateServices(projectRoot, model) {
  const servicesDir = path.join(projectRoot, 'src', 'services');

  fs.mkdirSync(servicesDir, {
    recursive: true,
  });

  model.resources.forEach((resource) => {
    const file = path.join(servicesDir, `${resource.fileName}.service.ts`);

    fs.writeFileSync(file, render(resource), 'utf8');

    console.log(`✓ Service ${resource.fileName}`);
  });
};

function render(resource) {
  const methods = resource.operations.map(renderMethod).join('\n\n');

  return `import { LambdaRequest } from "@api-hub/utils";
import {
    createLogger,
    createChildLogger
} from "@api-hub/observability";

import {
    ${resource.className}Repository,
    get${resource.className}Repository
} from "../repositories/${resource.fileName}.repository";

const baseLogger = createLogger({
    service: "${resource.fileName}-service",
    redactPII: true,
});

export class ${resource.className}Service {

    private readonly logger =
        createChildLogger(
            baseLogger,
            {
                service: "${resource.className}Service"
            }
        );

    constructor(

        private readonly repository: ${resource.className}Repository =
            get${resource.className}Repository()

    ) {
        this.repository;
    }

${methods}

}

let service: ${resource.className}Service;

export function get${resource.className}Service() {

    if (!service) {

        service =
            new ${resource.className}Service();

    }

    return service;

}
`;
}

function renderMethod(operation) {
  return `

    async ${operation.methodName}(
        request: LambdaRequest
    ) {

        this.logger.info({
            event: "${operation.methodName}",
        });

        /**
         * TODO
         * Implement business logic
         */

        throw new Error(
            "Not Implemented"
        );

    }`;
}
