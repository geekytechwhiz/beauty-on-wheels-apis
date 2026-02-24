import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { DEVICE_TABLE, REGION } from './constants';
import { DeviceDynamoDBItem } from './types';

const dbClient = new DynamoDBClient({ region: REGION });
const marshallOptions = {
	convertEmptyValues: false,
	removeUndefinedValues: true,
	convertClassInstanceToMap: false
};
const unmarshallOptions = {
	wrapNumbers: false
};
const translateConfig = { marshallOptions, unmarshallOptions };
const ddbDocClient = DynamoDBDocumentClient.from(dbClient, translateConfig);

export const batchWriteItems = async (items: DeviceDynamoDBItem[], tableName: string): Promise<void> => {
	const BATCH_SIZE = 25;
	
	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const batch = items.slice(i, i + BATCH_SIZE);
		const request = {
			RequestItems: {
				[tableName]: batch.map((item) => ({ PutRequest: { Item: item } })),
			},
		};
		await ddbDocClient.send(new BatchWriteCommand(request));
	}
};
