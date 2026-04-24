import { createPipeline, Middleware } from "./pipeline";

export const createConsumerHandler = ({
  middlewares,
  handler,
}: {
  middlewares: Middleware[];
  handler: (event: any, context: any) => Promise<any>;
}) => {
  return createPipeline(middlewares, handler);
};