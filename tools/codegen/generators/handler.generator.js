const fs = require('fs');
const path = require('path');

module.exports = function generateHandlers(projectRoot, model) {
  const handlersDir = path.join(projectRoot, 'src', 'handlers');

  fs.mkdirSync(handlersDir, {
    recursive: true,
  });

  model.resources.forEach((resource) => {
    const file = path.join(handlersDir, `${resource.fileName}.handler.ts`);

    const content = render(resource);

    fs.writeFileSync(file, content, 'utf8');

    console.log('✓ Handler', resource.fileName);
  });
};

function render(resource) {
  const operationsWithRequest = resource.operations.filter(op => op.request && op.request.name);

  const validatorImports = operationsWithRequest.length > 0
    ? `import {
    ${operationsWithRequest.map((op) => `validate${op.request.name}`).join(',\n    ')}
} from "../schemas/${resource.fileName}.schema";`
    : '';

  const handlers = resource.operations.map(renderHandler).join('\n\n');

  return `import { withApiHandler } from "@api-hub/middleware";
import { LambdaRequest } from "@api-hub/utils";

import {
    get${resource.className}Controller
} from "../controllers/${resource.fileName}.controller";

${validatorImports}

const controller =
    get${resource.className}Controller();

${handlers}
`;
}

function renderHandler(operation) {
  const validatorOption = (operation.request && operation.request.name)
    ? `\n            validator: (request: LambdaRequest) => { validate${operation.request.name}(request); }`
    : '';

  return `export const ${operation.handlerName} =
    withApiHandler(
        {
            operation: "${operation.methodName}",${validatorOption}
        },
        async (request: LambdaRequest) =>
            controller.${operation.handlerName}(request)
    );`;
}
