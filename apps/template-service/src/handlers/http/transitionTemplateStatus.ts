import { withTemplateApiHandler } from '../../utils/template-api-handler.util';
import { LambdaRequest } from '@api-hub/utils';

import { getTemplateHttpController } from '../../controllers/template-http.controller';
import { validateStatusTransitionRequest } from '../../validators/request.validators';
import { statusTransitionBodySchema } from '../../validators/template.schemas';

const c = getTemplateHttpController();

export const main = withTemplateApiHandler(
  {
    operation: 'template.status.transition',
    bodySchema: statusTransitionBodySchema,
    validator: validateStatusTransitionRequest,
  },
  (req: LambdaRequest) => c.handleStatusTransition(req),
);

export default main;
