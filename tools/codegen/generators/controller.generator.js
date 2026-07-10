const fs = require('fs');
const path = require('path');

module.exports = function generateControllers(projectRoot, model) {
  const controllersDir = path.join(projectRoot, 'src', 'controllers');

  fs.mkdirSync(controllersDir, {
    recursive: true,
  });

  model.resources.forEach((resource) => {
    const file = path.join(
      controllersDir,
      `${resource.fileName}.controller.ts`,
    );

    fs.writeFileSync(file, render(resource), 'utf8');

    console.log(`✓ Controller ${resource.fileName}`);
  });
};

function render(resource) {
  const methods = resource.operations.map(renderMethod).join('\n\n');

  return `import { LambdaRequest } from "@api-hub/utils";

import {
    ${resource.className}Service,
    get${resource.className}Service
} from "../services/${resource.fileName}.service";

export class ${resource.className}Controller {

    constructor(

        private readonly service: ${resource.className}Service =
            get${resource.className}Service()

    ) {}

${methods}

}

let controller: ${resource.className}Controller;

export function get${resource.className}Controller() {

    if (!controller) {

        controller =
            new ${resource.className}Controller();

    }

    return controller;

}
`;
}

function renderMethod(operation) {
  return `

    async ${operation.handlerName}(
        request: LambdaRequest
    ) {

        return this.service.${operation.methodName}(
            request
        );

    }`;
}
