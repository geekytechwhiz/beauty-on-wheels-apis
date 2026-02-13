import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.REGION || 'us-east-1' });

/**
 * Invoke Lambda function to get mobile screens/onboarding screens
 * @param functionName - The name of the Lambda function to invoke
 * @param params - Parameters to pass to the Lambda function
 * @param invocationType - Type of invocation (RequestResponse, Event, or DryRun)
 * @returns The data from the Lambda response (data?.items || data) or null on error
 */
export const getMobileScreens = async (
  functionName: string,
  params: Record<string, unknown>,
  invocationType: 'RequestResponse' | 'Event' | 'DryRun' = 'RequestResponse'
) => {
  try {
    const command = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: invocationType,
      Payload: JSON.stringify(params),
    });
    const result = await lambdaClient.send(command);

    if (result && result.Payload) {
      const response = JSON.parse(Buffer.from(result.Payload).toString());
      console.log('invoke response', response);
      
      // Check if the response indicates an error
      if (response.success === false || response.statusCode >= 400) {
        console.error(`Lambda function ${functionName} returned error:`, response.message || response.error);
        return null;
      }
      
      // Extract data from response
      const { data } = response;
      return data?.items || data;
    } else {
      return null;
    }
  } catch (err) {
    console.error(`Error invoking Lambda function ${functionName}: `, err);
    return null;
  }
};
