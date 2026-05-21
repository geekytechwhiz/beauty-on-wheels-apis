/**
 * Minimal AWS Lambda invocation context surface for shared libraries.
 * Avoids a runtime dependency on the `aws-lambda` npm package; use `@types/aws-lambda`
 * only where full transport event shapes are required (e.g. SQS, API Gateway).
 */
export type LambdaInvocationContext = {
  awsRequestId?: string;
  getRemainingTimeInMillis?: () => number;
};

export function awsRequestIdFromInvocationContext(
  lambdaContext: unknown,
): string {
  if (
    lambdaContext &&
    typeof lambdaContext === 'object' &&
    'awsRequestId' in lambdaContext &&
    typeof (lambdaContext as LambdaInvocationContext).awsRequestId === 'string'
  ) {
    return (lambdaContext as LambdaInvocationContext).awsRequestId!;
  }
  return 'unknown-request-id';
}
