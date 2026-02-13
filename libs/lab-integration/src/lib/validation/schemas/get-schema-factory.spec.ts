import {
  getCreateOrderSchema,
  getRescheduleOrderSchema,
  getCancelOrderSchema,
} from './get-schema-factory';

describe('get-schema-factory', () => {
  describe('getCreateOrderSchema', () => {
    it('returns redcliffe schema for redcliffe partnerId', () => {
      const schema = getCreateOrderSchema('redcliffe');
      expect(schema).toBeDefined();
      const result = schema.safeParse({
        partnerId: 'redcliffe',
        patientId: 'p1',
        patientName: 'Test User',
        testCodes: ['T1'],
        bookingDate: '2025-12-01',
        collectionDate: '2025-12-01',
        collectionSlot: 1,
        customerEmail: 'a@b.com',
        customerGender: 'male',
        customerLatitude: 12,
        customerLongitude: 77,
        customerPhoneNumber: '9876543210',
        customerWhatsAppNumber: '9876543210',
        isCredit: false,
        landmark: 'LM',
        pincode: '560001',
      });
      expect(result.success).toBe(true);
    });

    it('returns orange schema for orange partnerId', () => {
      const schema = getCreateOrderSchema('orange');
      expect(schema).toBeDefined();
      const result = schema.safeParse({
        partnerId: 'orange',
        patientId: 'p1',
        testCodes: ['T1'],
      });
      expect(result.success).toBe(true);
    });

    it('returns base schema for unknown partnerId', () => {
      const schema = getCreateOrderSchema('unknown');
      expect(schema).toBeDefined();
      const result = schema.safeParse({
        partnerId: 'unknown',
        patientId: 'p1',
        testCodes: ['T1'],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('getRescheduleOrderSchema', () => {
    it('returns redcliffe reschedule schema for redcliffe', () => {
      const schema = getRescheduleOrderSchema('redcliffe');
      const result = schema.safeParse({
        partnerId: 'redcliffe',
        orderId: '123',
        collectionDate: '2025-12-01',
        collectionSlot: 1,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('getCancelOrderSchema', () => {
    it('returns base cancel schema for any partner', () => {
      const schema = getCancelOrderSchema('redcliffe');
      const result = schema.safeParse({
        partnerId: 'redcliffe',
        orderId: '123',
      });
      expect(result.success).toBe(true);
    });
  });
});
