import { withApiHandler  } from '@api-hub/middleware';  
import { LambdaRequest } from '@api-hub/utils';

 

const controller = async (req: LambdaRequest) => {
  return {
    status: 'ok',
    service: 'template-service'
  };
};

export const handler = withApiHandler({
  operation: 'template.health',
  validator: {}
}, controller);

export default handler;
