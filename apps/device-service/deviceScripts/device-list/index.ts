import { batchWriteItems } from './dynamodb';
import { CATEGORY, DEVICE_LIST, SCRIPT_EXECUTE_COMPLETED, ERROR, S3_BUCKET, S3_KEY, FILE_KEY, FILE_TYPE_KEY, DEVICE_TABLE, REGION } from './constants';
import { readFile } from 'fs';
import { promisify } from 'util';
import * as path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DevicesData, DeviceDynamoDBItem } from './types';

// Helper to get script directory - works when compiled to CommonJS
// __dirname is available at runtime after TypeScript compiles to CommonJS
declare const __dirname: string;

const getScriptDir = (): string => {
	// @ts-ignore - __dirname exists at runtime after compilation to CommonJS
	if (typeof __dirname !== 'undefined') {
		// @ts-ignore
		return __dirname;
	}
	// Fallback: resolve from current working directory
	return path.resolve(process.cwd(), 'deviceScripts/device-list');
};

const readFileAsync = promisify(readFile);
const s3Client = new S3Client();

function parseArgs() {
	const args = process.argv.slice(2);
	let env = process.env.STAGE || process.env.SERVERLESS_STAGE || null;
	let tableName = process.env.DEVICE_TABLE || DEVICE_TABLE || null;
	let uploadToS3 = process.env.UPLOAD_TO_S3 === 'true';
	let dryRun = false;
	
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--env' && args[i + 1]) env = args[++i];
		else if (args[i] === '--table' && args[i + 1]) tableName = args[++i];
		else if (args[i] === '--upload-s3') uploadToS3 = true;
		else if (args[i] === '--dry-run') dryRun = true;
	}
	
	if (!tableName && env) {
		tableName = `device-table-${env}`;
	}
	
	return { env, tableName, uploadToS3, dryRun };
}

function transformDevicesToDynamoDBItems(devicesData: DevicesData): DeviceDynamoDBItem[] {
	const items: DeviceDynamoDBItem[] = [];

	for (const category of devicesData.categories) {
		const categoryName = category.categoryName;
		for (const manufacturer of category.manufacturers) {
			const manufacturerName = manufacturer.manufacturerName;
			const manufacturerImage = manufacturer.manufacturerImage || '';
			for (const device of manufacturer.devices) {
				const item: DeviceDynamoDBItem = {
					pk: DEVICE_LIST,
					sk: `${CATEGORY}#${categoryName}#${device.deviceId}`,
					sk3: `${device.deviceId.toUpperCase().split(' ').join('_')}`,
					sk4: `${categoryName.toUpperCase().split(' ').join('_')}`,
					category: categoryName,
					deviceId: device.deviceId,
					name: device.name,
					displayName: device.displayName,
					enabled: device.enabled !== undefined ? device.enabled : true,
					countriesSupported: device.countriesSupported ?? [],
					supportedVitals: device.supportedVitals ?? [],
					ACDeviceInfoUserDataServiceUUIDKey: device.ACDeviceInfoUserDataServiceUUIDKey ?? '',
					animationLink: device.animationLink ?? '',
					autoSyncDelay: device.autoSyncDelay ?? 0,
					companyIdentifier: manufacturer.companyIdentifier !== undefined ? String(manufacturer.companyIdentifier) : '',
					deviceDetails: device.deviceDetails ?? '',
					deviceGroupId: device.deviceGroupId !== undefined ? String(device.deviceGroupId) : '0',
					deviceImage: device.deviceImage ?? '',
					deviceIncludedGroupId: device.deviceIncludedGroupId !== undefined ? String(device.deviceIncludedGroupId) : '0',
					deviceSecondaryIncludedGroupId: device.deviceSecondaryIncludedGroupId !== undefined ? String(device.deviceSecondaryIncludedGroupId) : '0',
					externalVideoLink: device.externalVideoLink ?? '',
					isAutoSyncSupported: device.isAutoSyncSupported !== undefined ? device.isAutoSyncSupported : false,
					manufacturerImage: manufacturerImage ?? '',
					manufacturerName: manufacturerName ?? '',
					noOfUsers: device.noOfUsers ?? 1,
					pairingErrorAnimationLink: device.pairingErrorAnimationLink ?? '',
					requiresPairing: device.requiresPairing !== undefined ? device.requiresPairing : false,
					supportsUserAuthentication: device.supportsUserAuthentication !== undefined ? device.supportsUserAuthentication : false,
					template: device.templateId ?? 0,
					useExtensionProtocol: device.useExtensionProtocol !== undefined ? device.useExtensionProtocol : false
				};
				items.push(item);
			}
		}
	}

	return items;
}

const start = async (): Promise<void> => {
	try {
		const { tableName, uploadToS3, dryRun } = parseArgs();
		
		if (!tableName) {
			console.error('Set --env (dev|stg|prd), --table <tableName>, or DEVICE_TABLE environment variable');
			process.exit(1);
		}

		// Read devices.json from utils directory
		// Path: deviceScripts/device-list -> deviceScripts -> device-service -> src/utils/devices.json
		const scriptDir = getScriptDir();
		const devicesJsonPath = path.resolve(scriptDir, '../../src/utils/devices.json');
		const devicesJson = await readFileAsync(devicesJsonPath, 'utf8');
		const devicesData: DevicesData = JSON.parse(devicesJson);

		// Transform hierarchical structure to DynamoDB items
		const items = transformDevicesToDynamoDBItems(devicesData);
		
		if (items.length === 0) {
			console.error('No devices found in', devicesJsonPath);
			process.exit(1);
		}

		console.log('Table:', tableName);
		console.log('Items:', items.length);
		console.log('Dry run:', dryRun);
		console.log('Upload to S3:', uploadToS3);

		if (dryRun) {
			console.log('[DRY-RUN] Would put', items.length, 'items');
			return;
		}

		// Batch write items to DynamoDB
		console.log('Writing items to DynamoDB...');
		await batchWriteItems(items, tableName);
		console.log('Done. Inserted', items.length, 'device list items into', tableName);

		// Upload devices.json to S3 (optional)
		if (uploadToS3 && S3_BUCKET) {
			try {
				const fileData = await readFileAsync(devicesJsonPath);
				const params = {
					Bucket: S3_BUCKET,
					Key: `${S3_KEY}${FILE_KEY}`,
					Body: fileData,
					ContentType: FILE_TYPE_KEY
				};
				const command = new PutObjectCommand(params);
				await s3Client.send(command);
				console.log('File uploaded successfully to S3');
			} catch (error) {
				console.error('Error while uploading file to S3', error);
				// Don't fail the script if S3 upload fails
			}
		}

		console.log(SCRIPT_EXECUTE_COMPLETED);
	} catch (error) {
		console.error(ERROR, error);
		process.exit(1);
	}
};

start();
