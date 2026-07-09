import { IdentityKeyBuilder } from './identity-key.builder';

describe('IdentityKeyBuilder', () => {
  it('builds user partition and sort keys', () => {
    expect(IdentityKeyBuilder.toUserPk('user-1')).toBe('USER#user-1');
    expect(IdentityKeyBuilder.toUserMetaSk()).toBe('META');
    expect(IdentityKeyBuilder.toUserProfileSk()).toBe('PROFILE');
  });

  it('normalizes email and username', () => {
    expect(IdentityKeyBuilder.normalizeEmail('  Test@Example.COM ')).toBe('test@example.com');
    expect(IdentityKeyBuilder.normalizeUsername('  MyUser ')).toBe('myuser');
  });

  it('builds lookup keys', () => {
    expect(IdentityKeyBuilder.toEmailLookupPk('a@b.com')).toBe('EMAIL#a@b.com');
    expect(IdentityKeyBuilder.toUsernameLookupPk('myuser')).toBe('USERNAME#myuser');
    expect(IdentityKeyBuilder.toLookupSk()).toBe('LOOKUP');
  });

  it('builds session and otp sort keys', () => {
    expect(IdentityKeyBuilder.toSessionSk('sess-1')).toBe('SESSION#sess-1');
    expect(IdentityKeyBuilder.toOtpSk('login')).toBe('OTP#login');
  });

  it('builds GSI keys', () => {
    expect(IdentityKeyBuilder.buildGsi2Pk('hash-1')).toBe('REFRESH#hash-1');
    expect(IdentityKeyBuilder.buildGsi2Sk('u1', 's1')).toBe('USER#u1#SESSION#s1');
    expect(IdentityKeyBuilder.buildGsi3Pk('ref-1')).toBe('OTP_REF#ref-1');
    expect(IdentityKeyBuilder.buildGsi3Sk('u1', 'login')).toBe('USER#u1#OTP#login');
    expect(IdentityKeyBuilder.buildGsi4Pk('active')).toBe('STATUS#active');
  });
});
