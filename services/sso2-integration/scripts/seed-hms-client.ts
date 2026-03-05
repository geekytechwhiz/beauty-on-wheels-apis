// ─────────────────────────────────────────────────────────────────────────────
// SEED SCRIPT — Register an HMS Client for local dev / testing
// Run: npm run seed
// ─────────────────────────────────────────────────────────────────────────────

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { createHash, randomBytes } from "crypto";
import { v4 as uuidv4 } from "uuid";

// ── Config ────────────────────────────────────────────────────────────────────
const ENV = process.env["ENV"] ?? "dev";
const TABLE_NAME = `sso-hms-clients-${ENV}`;
const REGION = process.env["AWS_REGION"] ?? "us-east-1";

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

function generateApiKey(clientId: string): string {
  const secret = randomBytes(32).toString("hex");
  return `hms_${clientId}_${secret}`;
}

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

async function seedHmsClient(): Promise<void> {
  const clientId = "HMS-ORG-001";
  const clientName = "City General Hospital";

  console.log(`\n🌱 Seeding HMS client: ${clientId}`);
  console.log(`   Table: ${TABLE_NAME}`);
  console.log(`   Region: ${REGION}\n`);

  // Check if already exists
  const existing = await docClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { clientId } })
  );

  if (existing.Item) {
    console.log(`⚠️  HMS client '${clientId}' already exists. Skipping.`);
    console.log(`   Use the admin API to update or delete it.\n`);
    return;
  }

  const plainApiKey = generateApiKey(clientId);
  const apiKeyHash = hashApiKey(plainApiKey);
  const now = new Date().toISOString();

  const item = {
    clientId,
    clientName,
    apiKeyHash,
    allowedScopes: [
      "read:patient",
      "read:health-records",
      "read:medications",
      "read:lab-results",
    ],
    allowedRedirectUris: [
      "https://app.myvitalrx.com/launch",
      "http://localhost:3000/launch",         // local dev
      "http://localhost:3001/launch",
    ],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  console.log("✅ HMS Client registered successfully!\n");
  console.log("════════════════════════════════════════════════════════");
  console.log(`  Client ID   : ${clientId}`);
  console.log(`  Client Name : ${clientName}`);
  console.log(`  API Key     : ${plainApiKey}`);
  console.log("════════════════════════════════════════════════════════");
  console.log("\n⚠️  IMPORTANT: Save the API Key above — it will NOT be shown again!");
  console.log(
    "\n📋 HMS should include these headers on POST /hms/launch:\n" +
    `   X-HMS-Client-Id: ${clientId}\n` +
    `   X-HMS-Api-Key: ${plainApiKey}\n`
  );
}

seedHmsClient().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
