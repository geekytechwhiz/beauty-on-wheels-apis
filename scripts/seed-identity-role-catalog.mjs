import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
} from '@aws-sdk/lib-dynamodb';

function option(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : fallback;
}

const stage = option('--stage', 'dev');
const table = option('--table', `identity-table-${stage}`);
const region = option('--region', process.env.AWS_REGION ?? 'us-east-1');
const apply = process.argv.includes('--apply');

if (!table || !region) {
    throw new Error('Provide --table and --region');
}

const roles = [
    {
        roleId: 'ADMIN',
        name: 'Administrator',
        description: 'Platform administrator',
    },
    {
        roleId: 'CUSTOMER',
        name: 'Customer',
        description: 'Customer application role',
    },
    {
        roleId: 'REGISTRANT',
        name: 'Registrant',
        description: 'Vendor registration role',
    },
    {
        roleId: 'VENDOR',
        name: 'Vendor',
        description: 'Approved vendor application role',
    },
];

const ddb = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region }),
);

console.log(`${apply ? 'APPLY' : 'DRY RUN'} · ${table} · ${region}`);

for (const role of roles) {
    const item = {
        PK: `ROLE#${role.roleId}`,
        SK: 'METADATA',
        entityType: 'Role',
        roleId: role.roleId,
        name: role.name,
        description: role.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        GSI1PK: 'ROLE_CATALOG',
        GSI1SK: `ROLE#${role.roleId}`,
    };

    const key = { PK: item.PK, SK: item.SK };
    const existing = await ddb.send(
        new GetCommand({ TableName: table, Key: key }),
    );

    if (existing.Item) {
        if (
            existing.Item.entityType !== 'Role' ||
            existing.Item.roleId !== role.roleId
        ) {
            throw new Error(
                `Unexpected item already exists at ${item.PK}/${item.SK}; refusing to overwrite`,
            );
        }

        console.log(`EXISTS · ${role.roleId}`);
        continue;
    }

    if (!apply) {
        console.log(`WOULD CREATE · ${role.roleId} · ${item.PK}/${item.SK}`);
        continue;
    }

    await ddb.send(
        new PutCommand({
            TableName: table,
            Item: item,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        }),
    );

    console.log(`CREATED · ${role.roleId}`);
}