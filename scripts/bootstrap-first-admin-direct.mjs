#!/usr/bin/env node
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminGetUserCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const pbkdf2 = promisify(crypto.pbkdf2);
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Direct first ADMIN bootstrap (no Identity HTTP API / OTP send)

Required:
  --stage dev --region us-east-1 --expected-account-id 123456789012
  --table identity-table-dev --user-pool-id us-east-1_XXXXXXXXX
  --phone +919497644904 --email person@example.com
  --first-name Prasanth --last-name Example
  --approved-by admin@example.com --executed-by operator --change-ticket CRS-1

Preview by default. Add --apply to write. Production also requires
--confirm-production. A real email is required by the configured Cognito pool.
`);
  process.exit(0);
}

const required = [
  'stage', 'region', 'expected-account-id', 'table', 'user-pool-id', 'phone', 'email',
  'first-name', 'last-name', 'approved-by', 'executed-by', 'change-ticket',
];
for (const name of required) if (!args[name]) fail(`Missing required argument: --${name}`);
if (args.stage.toLowerCase() === 'production' && !args['confirm-production']) {
  fail('Production requires --confirm-production');
}
if (args.stage.toLowerCase() === 'prod' && !args['confirm-production']) {
  fail('Production requires --confirm-production');
}
if (args['approved-by'].trim().toLowerCase() === args['executed-by'].trim().toLowerCase()) {
  fail('--approved-by and --executed-by must be different people');
}

const phone = normalizePhone(args.phone);
const email = args.email.trim().toLowerCase();
const username = phone;
const now = new Date().toISOString();
const userId = `u-${crypto.randomUUID()}`;
const auditId = crypto.randomUUID();
const region = args.region;
const table = args.table;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const cognito = new CognitoIdentityProviderClient({ region });
const sts = new STSClient({ region });

try {
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  if (identity.Account !== args['expected-account-id']) {
    fail(`AWS account mismatch: expected ${args['expected-account-id']}, got ${identity.Account ?? 'unknown'}`);
  }
  console.log(JSON.stringify({
    event: args.apply ? 'direct_admin_bootstrap_apply' : 'direct_admin_bootstrap_dry_run',
    stage: args.stage, region, account: identity.Account, table,
    userPoolId: args['user-pool-id'], phone,
    email: email || undefined, userId, role: 'ADMIN',
    phoneVerified: true,
    primaryIdentifier: 'phone',
    note: 'Phone is primary and marked verified; email is Cognito-schema fallback only.',
  }, null, 2));
  if (!args.apply) {
    console.log('Dry run only. Re-run with --apply to create the Cognito user and Identity records.');
    process.exit(0);
  }

  const roleMetaKey = { PK: 'ROLE#ADMIN', SK: 'METADATA' };
  const existingRole = await ddb.send(new GetCommand({
    TableName: table,
    Key: roleMetaKey,
    ConsistentRead: true,
  }));
  if (existingRole.Item && (existingRole.Item.roleId !== 'ADMIN' || existingRole.Item.entityType !== 'Role')) {
    fail('ROLE#ADMIN/METADATA exists but does not match the expected Role record; inspect it before proceeding.');
  }
  const existingPhone = await ddb.send(new GetCommand({
    TableName: table,
    Key: { PK: `PHONE#${phone}`, SK: 'LOOKUP' },
    ConsistentRead: true,
  }));
  if (existingPhone.Item) fail('Identity table already has a user for this phone; refusing to create a duplicate.');

  // Cognito pool uses phone/email as aliases — Username must not be phone format.
  // Match authentication-core: bow_<uuid without dashes>.
  let createdCognito = false;
  let cognitoUsername = `bow_${crypto.randomUUID().replace(/-/g, '')}`;
  let sub;
  try {
    const created = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: args['user-pool-id'],
      Username: cognitoUsername,
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'phone_number', Value: phone },
        { Name: 'phone_number_verified', Value: 'true' },
        { Name: 'name', Value: `${args['first-name'].trim()} ${args['last-name'].trim()}`.trim() },
        // Email is required by the Cognito pool schema; treat as fallback only.
        ...(email ? [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'false' }] : []),
      ],
    }));
    createdCognito = true;
    cognitoUsername = created.User?.Username ?? cognitoUsername;
    sub = created.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
    if (!sub) {
      const fetched = await cognito.send(new AdminGetUserCommand({ UserPoolId: args['user-pool-id'], Username: cognitoUsername }));
      sub = fetched.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
    }
    if (!sub) throw new Error('Cognito created the user but did not return a sub.');
    // Set an unknown random permanent password so the user is not stuck in FORCE_CHANGE_PASSWORD.
    await cognito.send(new AdminSetUserPasswordCommand({
      UserPoolId: args['user-pool-id'], Username: cognitoUsername,
      Password: crypto.randomBytes(48).toString('base64url') + 'aA1!', Permanent: true,
    }));
  } catch (error) {
    throw new Error(`Cognito create failed: ${safeError(error)}`);
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const unusablePassword = crypto.randomBytes(32).toString('hex');
  const passwordHash = `${salt}:${(await pbkdf2(unusablePassword, salt, 10000, 64, 'sha512')).toString('hex')}`;
  const normalizedEmail = email;
  const transact = [];
  if (!existingRole.Item) {
    transact.push({
      Put: {
        TableName: table, Item: {
          ...roleMetaKey, entityType: 'Role', roleId: 'ADMIN', name: 'Administrator',
          description: 'Platform administrator role', createdAt: now, updatedAt: now,
        }, ConditionExpression: 'attribute_not_exists(PK)'
      }
    });
  }
  transact.push(
    {
      Put: {
        TableName: table, Item: {
          PK: `USER#${userId}`, SK: 'META', entityType: 'User', userId,
          email: normalizedEmail, username, phoneNumber: phone, passwordHash,
          roleId: 'user', status: 'ACTIVE', emailVerified: false, phoneVerified: true,
          version: 1, identityId: sub, cognitoUsername, userType: 'ADMIN', createdAt: now, updatedAt: now,
        }, ConditionExpression: 'attribute_not_exists(PK)'
      }
    },
    {
      Put: {
        TableName: table, Item: {
          PK: `USER#${userId}`, SK: 'PROFILE', entityType: 'Profile', userId,
          firstName: args['first-name'].trim(), lastName: args['last-name'].trim(),
          ...(normalizedEmail ? { email: normalizedEmail } : {}), phoneNumber: phone,
          identityId: sub, userType: 'ADMIN',
          userProvisioning: { status: 'PENDING', requestedAt: now }, createdAt: now, updatedAt: now,
        }, ConditionExpression: 'attribute_not_exists(PK)'
      }
    },
    {
      Put: {
        TableName: table, Item: {
          PK: `PHONE#${phone}`, SK: 'LOOKUP', entityType: 'PhoneLookup', userId,
          phoneNumber: phone, GSI1PK: `PHONE#${phone}`, GSI1SK: `USER#${userId}`,
          createdAt: now, updatedAt: now,
        }, ConditionExpression: 'attribute_not_exists(PK)'
      }
    },
    {
      Put: {
        TableName: table, Item: {
          PK: `USERNAME#${username.toLowerCase()}`, SK: 'LOOKUP', entityType: 'UsernameLookup', userId,
          username: username.toLowerCase(), GSI1PK: `USERNAME#${username.toLowerCase()}`, GSI1SK: `USER#${userId}`,
          createdAt: now, updatedAt: now,
        }, ConditionExpression: 'attribute_not_exists(PK)'
      }
    },
    {
      Put: {
        TableName: table, Item: {
          PK: `IDENTITY#${sub}`, SK: 'LOOKUP', entityType: 'IdentityLookup', userId,
          identityId: sub, GSI1PK: `IDENTITY#${sub}`, GSI1SK: `USER#${userId}`,
          createdAt: now, updatedAt: now,
        }, ConditionExpression: 'attribute_not_exists(PK)'
      }
    },
    {
      Put: {
        TableName: table, Item: {
          PK: `USER#${userId}`, SK: 'ROLE#ADMIN', entityType: 'UserRole', userId, roleId: 'ADMIN',
          createdAt: now, updatedAt: now,
        }, ConditionExpression: 'attribute_not_exists(PK)'
      }
    },
    {
      Put: {
        TableName: table, Item: {
          PK: `AUDIT#${auditId}`, SK: 'METADATA', entityType: 'AuditLog', auditId, userId,
          action: 'BOOTSTRAP_ADMIN', details: JSON.stringify({ approvedBy: args['approved-by'], executedBy: args['executed-by'], changeTicket: args['change-ticket'] }),
          timestamp: now, createdAt: now, updatedAt: now,
          GSI1PK: `USER#${userId}`, GSI1SK: `AUDIT#${now}`,
        }, ConditionExpression: 'attribute_not_exists(PK)'
      }
    },
  );
  if (normalizedEmail) {
    transact.push({
      Put: {
        TableName: table, Item: {
          PK: `EMAIL#${normalizedEmail}`, SK: 'LOOKUP', entityType: 'EmailLookup', userId,
          email: normalizedEmail, GSI1PK: `EMAIL#${normalizedEmail}`, GSI1SK: `USER#${userId}`,
          createdAt: now, updatedAt: now,
        }, ConditionExpression: 'attribute_not_exists(PK)'
      }
    });
  }

  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: transact }));
  } catch (error) {
    // Compensate only the Cognito user created by this run, and only if the
    // DynamoDB user row did not commit. Never delete a pre-existing account.
    const committed = await ddb.send(new GetCommand({
      TableName: table,
      Key: { PK: `USER#${userId}`, SK: 'META' },
      ConsistentRead: true,
    })).then((result) => Boolean(result.Item)).catch(() => true);
    if (createdCognito && !committed) {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: args['user-pool-id'], Username: cognitoUsername })).catch(() => { });
    }
    throw new Error(`DynamoDB transaction failed${committed ? ' (user row may have committed; inspect before rerunning)' : '; newly created Cognito account was removed'}: ${safeError(error)}`);
  }

  console.log(JSON.stringify({ event: 'direct_admin_bootstrap_succeeded', userId, identityId: sub, cognitoUsername, role: 'ADMIN', phoneVerified: true, primaryIdentifier: 'phone', table, auditId }, null, 2));
} catch (error) {
  console.error(`Bootstrap failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}

function parseArgs(tokens) {
  const out = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--help' || token === '-h') { out.help = true; continue; }
    if (token === '--apply' || token === '--confirm-production') { out[token.slice(2)] = true; continue; }
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = tokens[++i];
    if (!value || value.startsWith('--')) fail(`Missing value for --${key}`);
    out[key] = value;
  }
  return out;
}
function normalizePhone(value) {
  const phone = value.trim().replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) fail('--phone must be E.164, e.g. +919497644904');
  return phone;
}
function safeError(error) {
  return error?.name ? `${error.name}: ${error.message ?? 'request failed'}` : 'request failed';
}
function fail(message) { console.error(message); process.exit(1); }
