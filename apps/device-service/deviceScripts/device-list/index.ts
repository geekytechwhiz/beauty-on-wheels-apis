/* eslint-disable @typescript-eslint/ban-ts-comment */
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFile } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { CATEGORY, DEVICE_LIST, DEVICE_TABLE, ERROR, FILE_KEY, FILE_TYPE_KEY, S3_BUCKET, S3_KEY } from './constants';
import { batchWriteItems } from './dynamodb';
import { DeviceDynamoDBItem, DevicesData } from './types';

// Helper to get the device-service root directory
// In CodeBuild, we run from device-service root, so __dirname is deviceScripts/device-list/dist/
// We need to go up 3 levels: dist -> device-list -> deviceScripts -> device-service root
const getDeviceServiceRoot = (): string => {
	// @ts-ignore - __dirname exists at runtime after compilation to CommonJS
	if (typeof __dirname !== 'undefined') {
		// @ts-ignore
		const scriptDir = __dirname;
		// From deviceScripts/device-list/dist/ -> go up 3 levels to device-service root
		// dist/ -> ../ -> device-list/ -> ../../ -> deviceScripts/ -> ../../.. -> device-service/
		return path.resolve(scriptDir, '../../..');
	}
	// Fallback: use current working directory (should be device-service root in CodeBuild)
	return process.cwd();
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
	let totalDevices = 0;

	// console.log('📦 Starting transformation of devices data...');
	// console.log(`   Found ${devicesData.categories.length} categories`);

	for (const category of devicesData.categories) {
		const categoryName = category.categoryName;
		let categoryDeviceCount = 0;
		
		for (const manufacturer of category.manufacturers) {
			const manufacturerName = manufacturer.manufacturerName;
			const manufacturerImage = manufacturer.manufacturerImage || '';
			
			for (const device of manufacturer.devices) {
				categoryDeviceCount++;
				totalDevices++;
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
		
		// console.log(`   ✓ Category "${categoryName}": ${categoryDeviceCount} devices`);
	}

	// console.log(`✅ Transformation complete: ${totalDevices} total devices processed`);
	return items;
}

const start = async (): Promise<void> => {
	// console.log('🚀 Device List Seeding Script Started');
	// console.log('=====================================');
	
	try {
		const { tableName, uploadToS3, dryRun } = parseArgs();
		
		if (!tableName) {
			console.error('❌ Error: Set --env (dev|stg|prd), --table <tableName>, or DEVICE_TABLE environment variable');
			process.exit(1);
		}

		// Read devices.json from utils directory
		// Get device-service root directory and resolve to src/utils/devices.json
		const deviceServiceRoot = getDeviceServiceRoot();
		const devicesJsonPath = path.resolve(deviceServiceRoot, 'src/utils/devices.json');
		
		// console.log(`📂 Reading devices.json from: ${devicesJsonPath}`);
		
		if (!require('fs').existsSync(devicesJsonPath)) {
			console.error(`❌ Error: Devices JSON file not found at: ${devicesJsonPath}`);
			process.exit(1);
		}
		
		const devicesJson = await readFileAsync(devicesJsonPath, 'utf8');
		const devicesData: DevicesData = JSON.parse(devicesJson);
		
		// console.log(`✅ Successfully loaded devices.json (${(devicesJson.length / 1024).toFixed(2)} KB)`);

		// Transform hierarchical structure to DynamoDB items
		const items = transformDevicesToDynamoDBItems(devicesData);
		
		if (items.length === 0) {
			console.error(`❌ Error: No devices found in ${devicesJsonPath}`);
			process.exit(1);
		}

		// console.log('\n📊 Configuration:');
		// console.log(`   Table: ${tableName}`);
		// console.log(`   Total Items: ${items.length}`);
		// console.log(`   Dry Run: ${dryRun ? 'YES' : 'NO'}`);
		// console.log(`   Upload to S3: ${uploadToS3 ? 'YES' : 'NO'}`);

		if (dryRun) {
			// console.log('\n🔍 [DRY-RUN MODE] Preview:');
			// console.log(`   Would write ${items.length} items to ${tableName}`);
			// console.log(`   Sample item: ${items[0]?.name} (${items[0]?.deviceId})`);
			// console.log('✅ Dry run completed - no changes made');
			return;
		}

		// Batch write items to DynamoDB
		// console.log('\n💾 Writing items to DynamoDB...');
		const startTime = Date.now();
		await batchWriteItems(items, tableName);
		const duration = ((Date.now() - startTime) / 1000).toFixed(2);
		
		// console.log(`✅ Successfully inserted ${items.length} device list items into ${tableName}`);
		// console.log(`   Duration: ${duration}s`);

		// Upload devices.json to S3 (optional)
		if (uploadToS3 && S3_BUCKET) {
			// console.log('\n☁️  Uploading devices.json to S3...');
			try {
				const fileData = await readFileAsync(devicesJsonPath);
				const s3Key = `${S3_KEY}${FILE_KEY}`;
				const params = {
					Bucket: S3_BUCKET,
					Key: s3Key,
					Body: fileData,
					ContentType: FILE_TYPE_KEY
				};
				const command = new PutObjectCommand(params);
				await s3Client.send(command);
				// console.log(`✅ File uploaded successfully to S3: s3://${S3_BUCKET}/${s3Key}`);
			} catch (error) {
				console.error('⚠️  Warning: Error while uploading file to S3:', error);
				console.error('   Script will continue - S3 upload is optional');
				// Don't fail the script if S3 upload fails
			}
		}

		// console.log('\n' + '='.repeat(50));
		// console.log(`✅ ${SCRIPT_EXECUTE_COMPLETED}`);
		// console.log('='.repeat(50));
	} catch (error) {
		console.error('\n' + '='.repeat(50));
		console.error(`❌ ${ERROR}`);
		console.error('='.repeat(50));
		if (error instanceof Error) {
			console.error('Error details:', error.message);
			if (error.stack) {
				console.error('Stack trace:', error.stack);
			}
		} else {
			console.error('Error:', error);
		}
		process.exit(1);
	}
};

start();