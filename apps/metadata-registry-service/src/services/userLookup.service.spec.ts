import {
  UNKNOWN_USER_LABEL,
  enrichMetadataRecordActors,
  resolveUserDisplayName,
} from './userLookup.service';

describe('resolveUserDisplayName', () => {
  it('prefers fullName, then first/last, then emailAddress, then legacy email', () => {
    expect(resolveUserDisplayName({ fullName: 'Jane Doe' })).toBe('Jane Doe');
    expect(resolveUserDisplayName({ firstName: 'Jane', lastName: 'Doe' })).toBe('Jane Doe');
    expect(resolveUserDisplayName({ emailAddress: 'jane@example.com' })).toBe('jane@example.com');
    expect(resolveUserDisplayName({ email: 'rootadmin@yopmail.com' })).toBe('rootadmin@yopmail.com');
    expect(resolveUserDisplayName({})).toBe(UNKNOWN_USER_LABEL);
  });

  it('resolves setup.sh root-admin row shape', () => {
    expect(
      resolveUserDisplayName({
        pk: 'ORG#ROOT',
        sk: 'USER#88a9a6e052092188660a404a303ca34c992caabfccfc184ca2121fcac2d84e7f',
        email: 'rootadmin@yopmail.com',
      }),
    ).toBe('rootadmin@yopmail.com');
  });

  it('resolves stg root-admin row with full profile fields', () => {
    expect(
      resolveUserDisplayName({
        pk: 'ORG#ROOT',
        sk: 'USER#88a9a6e052092188660a404a303ca34c992caabfccfc184ca2121fcac2d84e7f',
        firstName: 'Root',
        lastName: '',
        fullName: 'Root Admin',
        emailAddress: 'rootadmin@yopmail.com',
        userID: '88a9a6e052092188660a404a303ca34c992caabfccfc184ca2121fcac2d84e7f',
      }),
    ).toBe('Root Admin');
  });
});

describe('enrichMetadataRecordActors', () => {
  it('uses resolved display name for createdBy and lastModifiedBy', () => {
    const userId = '88a9a6e052092188660a404a303ca34c992caabfccfc184ca2121fcac2d84e7f';
    const userMap = new Map([[userId, { name: 'rootadmin@yopmail.com' }]]);

    const enriched = enrichMetadataRecordActors(
      { metadataTypeCode: 'ApplicableModule', createdBy: userId, lastModifiedBy: userId },
      userMap,
    );

    expect(enriched.createdBy).toEqual({ userId, name: 'rootadmin@yopmail.com' });
    expect(enriched.lastModifiedBy).toEqual({ userId, name: 'rootadmin@yopmail.com' });
  });
});
