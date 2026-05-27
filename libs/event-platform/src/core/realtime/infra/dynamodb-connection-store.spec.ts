/**
 * @jest-environment node
 */
import { DynamoDbConnectionStore } from './dynamodb-connection-store';
import { DynamoDbConnectionResolver } from '../services/dynamodb-connection-resolver.service';

function mockClient() {
  const send = jest.fn();
  return { send, client: { send } as never };
}

describe('DynamoDbConnectionStore', () => {
  it('queries DestinationIndex for resolveConnections', async () => {
    const { send, client } = mockClient();
    send.mockResolvedValueOnce({
      Items: [
        { connectionId: { S: 'conn-1' } },
        { connectionId: { S: 'conn-2' } },
      ],
    });

    const store = new DynamoDbConnectionStore({
      tableName: 'realtime-connections',
      client,
    });

    const ids = await store.resolveConnections('USER#DOC123');

    expect(ids).toEqual(['conn-1', 'conn-2']);
    const command = send.mock.calls[0]?.[0] as { input: { IndexName: string } };
    expect(command.input.IndexName).toBe('DestinationIndex');
  });
});

describe('DynamoDbConnectionResolver', () => {
  it('delegates to connection store', async () => {
    const resolveConnections = jest.fn().mockResolvedValue(['conn-1']);
    const resolver = new DynamoDbConnectionResolver({ resolveConnections } as never);

    await expect(resolver.resolve('ORG#ORG1#ALERTS')).resolves.toEqual(['conn-1']);
    expect(resolveConnections).toHaveBeenCalledWith('ORG#ORG1#ALERTS');
  });
});
