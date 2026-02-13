/**
 * Unit tests for legacy user details (DynamoDB).
 */

import {
  getUserDetails,
  isLegacySessionValid,
  type UserDetails,
} from './user-details';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  },
  QueryCommand: jest.fn().mockImplementation((input: unknown) => ({ __input: input })),
}));

describe('user-details', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserDetails', () => {
    it('returns null when userTable is empty', async () => {
      const result = await getUserDetails('', 'user-1', 'org-1');
      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns null when userID is empty', async () => {
      const result = await getUserDetails('user-table', '', 'org-1');
      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns null when organizationID is empty', async () => {
      const result = await getUserDetails('user-table', 'user-1', '');
      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns null when Items is null', async () => {
      mockSend.mockResolvedValue({ Items: null });

      const result = await getUserDetails('user-table', 'user-1', 'org-1');
      expect(result).toBeNull();
    });

    it('returns null when Items is empty', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await getUserDetails('user-table', 'user-1', 'org-1');
      expect(result).toBeNull();
    });

    it('returns UserDetails from first item', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            pk: 'USER#user-1',
            sk: 'USER_BASIC_DETAILS#org-1',
            emailAddress: 'a@b.com',
            phoneNumber: '5551234567',
            userType: 'USER',
            defaultProfile: 'DEFAULT',
            lastUsedAccount: 100,
            logoutAt: 0,
            tokenUpdatedAt: 50,
          },
        ],
      });

      const result = await getUserDetails('user-table', 'user-1', 'org-1');
      expect(result).toEqual({
        userID: 'user-1',
        organizationID: 'org-1',
        emailAddress: 'a@b.com',
        phoneNumber: '5551234567',
        userType: 'USER',
        defaultProfile: 'DEFAULT',
        lastUsedAccount: 100,
        logoutAt: 0,
        tokenUpdatedAt: 50,
        pk: 'USER#user-1',
        sk: 'USER_BASIC_DETAILS#org-1',
      });
    });

    it('sends QueryCommand with correct pk/sk', async () => {
      mockSend.mockResolvedValue({ Items: [{ userID: 'user-1', organizationID: 'org-1' }] });

      await getUserDetails('my-table', 'u1', 'o1');
      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArg = mockSend.mock.calls[0][0];
      expect(callArg?.__input?.TableName).toBe('my-table');
      expect(callArg?.__input?.ExpressionAttributeValues?.[':pk']).toBe('USER#u1');
      expect(callArg?.__input?.ExpressionAttributeValues?.[':sk']).toBe(
        'USER_BASIC_DETAILS#o1'
      );
    });
  });

  describe('isLegacySessionValid', () => {
    it('returns false when userDetails is null', () => {
      expect(isLegacySessionValid(null, 100)).toBe(false);
    });

    it('returns false when lastUsedAccount < logoutAt', () => {
      const details: UserDetails = {
        userID: 'u1',
        organizationID: 'o1',
        lastUsedAccount: 5,
        logoutAt: 10,
      };
      expect(isLegacySessionValid(details, 100)).toBe(false);
    });

    it('returns false when tokenUpdatedAt > tokenGeneratedTime', () => {
      const details: UserDetails = {
        userID: 'u1',
        organizationID: 'o1',
        lastUsedAccount: 10,
        logoutAt: 0,
        tokenUpdatedAt: 200,
      };
      expect(isLegacySessionValid(details, 100)).toBe(false);
    });

    it('returns true when tokenGeneratedTime is undefined', () => {
      const details: UserDetails = {
        userID: 'u1',
        organizationID: 'o1',
        lastUsedAccount: 10,
        logoutAt: 0,
      };
      expect(isLegacySessionValid(details, undefined)).toBe(true);
    });

    it('returns true when tokenUpdatedAt is undefined', () => {
      const details: UserDetails = {
        userID: 'u1',
        organizationID: 'o1',
        lastUsedAccount: 10,
        logoutAt: 0,
      };
      expect(isLegacySessionValid(details, 100)).toBe(true);
    });

    it('returns true when session is valid', () => {
      const details: UserDetails = {
        userID: 'u1',
        organizationID: 'o1',
        lastUsedAccount: 10,
        logoutAt: 0,
        tokenUpdatedAt: 50,
      };
      expect(isLegacySessionValid(details, 100)).toBe(true);
    });

    it('uses 0 for lastUsedAccount and logoutAt when undefined', () => {
      const details: UserDetails = {
        userID: 'u1',
        organizationID: 'o1',
      };
      expect(isLegacySessionValid(details, undefined)).toBe(true);
    });
  });
});
