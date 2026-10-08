import {
  QueryCommand,
  type QueryCommandInput,
  type QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { ddbDocClient, sendDoc } from '@api-hub/utils';

/**
 * Sums DynamoDB Query Count across pages.
 * Select COUNT does not return Items, so callers must not use items.length.
 */
export async function queryCount(
  params: Omit<QueryCommandInput, 'Select' | 'ExclusiveStartKey'>,
): Promise<number> {
  let total = 0;
  let exclusiveStartKey: QueryCommandInput['ExclusiveStartKey'];

  do {
    const result = await sendDoc<QueryCommandOutput>(
      ddbDocClient,
      new QueryCommand({
        ...params,
        Select: 'COUNT',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    total += result.Count ?? 0;
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return total;
}
