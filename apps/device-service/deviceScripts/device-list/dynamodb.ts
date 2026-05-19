import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb'; 

import { DeviceDynamoDBItem } from './types';
import { REGION } from './constants';

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
	const totalBatches = Math.ceil(items.length / BATCH_SIZE); 
	
	// console.log(`   Writing in batches of ${BATCH_SIZE} items (${totalBatches} batches total)...`);
	
	for (let i = 0; i < items.length; i += BATCH_SIZE) {
		const batch = items.slice(i, i + BATCH_SIZE);
		const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
		
		const request = {
			RequestItems: {
				[tableName]: batch.map((item) => ({ PutRequest: { Item: item } })),
			},
		};
		
		try {
			await ddbDocClient.send(new BatchWriteCommand(request) as any); 
		} catch (error) {
			console.error(`   ❌ Error in batch ${batchNumber}/${totalBatches}:`, error);
			throw error;
		}
	}
	
	// console.log(`   ✅ All batches completed successfully`);
};