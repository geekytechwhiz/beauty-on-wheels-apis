import { BookingsService } from './bookings.service';
import { BookingsRepository } from '../repositories/bookings.repository';
import { Booking } from '../types/api-types';
import { validateBooking } from '../schemas/bookings.schema';
import { LambdaRequest } from '@api-hub/utils';
import { NotFoundError, BusinessRuleError, ForbiddenError } from '@api-hub/utils';
import { AvailabilityGateway } from '../integrations/availability.client';
import { OperationalAccessGateway } from '../integrations/vendor.client';

function customerRequest(bookingId?: string, customerId = 'c1'): LambdaRequest {
    return {
        ...(bookingId ? { pathParameters: { bookingId } } : {}),
        context: { authContext: { userId: customerId } },
    } as unknown as LambdaRequest;
}

function adminRequest(overrides: Partial<LambdaRequest> = {}): LambdaRequest {
    return {
        context: { authContext: { userId: 'admin-1', roles: ['admin'] } },
        ...overrides,
    } as unknown as LambdaRequest;
}

describe('BookingsService Unit Tests', () => {
    let mockRepo: jest.Mocked<BookingsRepository>;
    let availability: jest.Mocked<AvailabilityGateway>;
    let operationalAccess: jest.Mocked<OperationalAccessGateway>;
    let service: BookingsService;

    beforeEach(() => {
        mockRepo = {
            getBookingById: jest.fn(),
            getBookingDetailsItem: jest.fn(),
            createBooking: jest.fn(),
            getCustomerBookings: jest.fn(),
            getVendorBookings: jest.fn(),
            getCommunityBookings: jest.fn(),
            listAllBookings: jest.fn(),
            updateBooking: jest.fn(),
            updateBookingStatus: jest.fn(),
            cancelBooking: jest.fn(),
            bookingExists: jest.fn()
        } as unknown as jest.Mocked<BookingsRepository>;

        availability = {
            reserveBooking: jest.fn(),
            consumeHold: jest.fn(),
            releaseAllocation: jest.fn().mockResolvedValue(undefined),
        };
        operationalAccess = {
            getOperationalAccess: jest.fn().mockResolvedValue({
                role: 'none',
                active: false,
            }),
        };
        service = new BookingsService(
            mockRepo,
            undefined,
            undefined,
            undefined,
            availability,
            undefined,
            operationalAccess,
        );
    });

    describe('getbookings', () => {
        it('queries customer bookings if customerId is present', async () => {
            const mockBookings: Booking[] = [{ id: 'b1', customerId: 'c1', bookingStatus: 'CREATED' }];
            mockRepo.getCustomerBookings.mockResolvedValue(mockBookings);

            const result = await service.getbookings(customerRequest(undefined, 'c1'));
            expect(result).toEqual(mockBookings);
            expect(mockRepo.getCustomerBookings).toHaveBeenCalledWith('c1');
        });

        it('rejects a customer id that does not match the authenticated customer', async () => {
            await expect(service.getbookings({
                ...customerRequest(undefined, 'c1'),
                params: { customerId: 'c2' },
            } as LambdaRequest)).rejects.toThrow();
            expect(mockRepo.getCustomerBookings).not.toHaveBeenCalled();
        });

        it('allows platform admin to list another customer', async () => {
            const mockBookings: Booking[] = [{ id: 'b1', customerId: 'c2' }];
            mockRepo.getCustomerBookings.mockResolvedValue(mockBookings);

            const result = await service.getbookings(adminRequest({
                pathParameters: { customerId: 'c2' },
                params: { customerId: 'c2' },
            }));
            expect(result).toEqual(mockBookings);
            expect(mockRepo.getCustomerBookings).toHaveBeenCalledWith('c2');
        });
    });

    describe('getvendorbookings', () => {
        it('lists bookings for a vendor owner', async () => {
            operationalAccess.getOperationalAccess.mockResolvedValue({
                role: 'owner',
                vendorId: 'v1',
                active: true,
            });
            const mockBookings: Booking[] = [{ id: 'b1', vendorId: 'v1' }];
            mockRepo.getVendorBookings.mockResolvedValue(mockBookings);

            const result = await service.getvendorbookings({
                pathParameters: { vendorId: 'v1' },
                context: { authContext: { userId: 'owner-1' } },
            } as unknown as LambdaRequest);

            expect(result).toEqual(mockBookings);
            expect(mockRepo.getVendorBookings).toHaveBeenCalledWith('v1');
        });

        it('rejects a vendor owner for a different vendor', async () => {
            operationalAccess.getOperationalAccess.mockResolvedValue({
                role: 'owner',
                vendorId: 'other',
                active: true,
            });

            await expect(service.getvendorbookings({
                pathParameters: { vendorId: 'v1' },
                context: { authContext: { userId: 'owner-1' } },
            } as unknown as LambdaRequest)).rejects.toThrow(ForbiddenError);
            expect(mockRepo.getVendorBookings).not.toHaveBeenCalled();
        });
    });

    describe('getcommunitybookings', () => {
        it('returns all community bookings for admin', async () => {
            const mockBookings: Booking[] = [
                { id: 'b1', vendorId: 'v1' },
                { id: 'b2', vendorId: 'v2' },
            ];
            mockRepo.getCommunityBookings.mockResolvedValue(mockBookings);

            const result = await service.getcommunitybookings(adminRequest({
                pathParameters: { communityId: 'co-1' },
            }));
            expect(result).toEqual(mockBookings);
        });

        it('filters community bookings to the vendor owner', async () => {
            operationalAccess.getOperationalAccess.mockResolvedValue({
                role: 'owner',
                vendorId: 'v1',
                active: true,
            });
            mockRepo.getCommunityBookings.mockResolvedValue([
                { id: 'b1', vendorId: 'v1' },
                { id: 'b2', vendorId: 'v2' },
            ]);

            const result = await service.getcommunitybookings({
                pathParameters: { communityId: 'co-1' },
                context: { authContext: { userId: 'owner-1' } },
            } as unknown as LambdaRequest);

            expect(result).toEqual([{ id: 'b1', vendorId: 'v1' }]);
        });
    });

    describe('getadminbookings', () => {
        it('lists all bookings for admin', async () => {
            const mockBookings: Booking[] = [{ id: 'b1' }];
            mockRepo.listAllBookings.mockResolvedValue(mockBookings);

            const result = await service.getadminbookings(adminRequest());
            expect(result).toEqual(mockBookings);
            expect(mockRepo.listAllBookings).toHaveBeenCalled();
        });

        it('rejects non-admin callers', async () => {
            await expect(service.getadminbookings(customerRequest())).rejects.toThrow(ForbiddenError);
            expect(mockRepo.listAllBookings).not.toHaveBeenCalled();
        });
    });

    describe('postbookings', () => {
        it('rejects a create payload that still sends quoteId', async () => {
            const req = {
                body: { quoteId: 'quote-1', vendorId: 'v1' },
                context: { authContext: { userId: 'customer-1' } },
                event: { headers: { 'Idempotency-Key': 'idem-1' } },
            } as unknown as LambdaRequest;

            await expect(service.postbookings(req)).rejects.toThrow();
            expect(mockRepo.createBooking).not.toHaveBeenCalled();
        });
    });

    describe('getbookingid', () => {
        it('returns booking if found', async () => {
            const mockBooking: Booking = { id: 'b1', customerId: 'c1' };
            mockRepo.getBookingById.mockResolvedValue(mockBooking);

            const req = customerRequest('b1');

            const result = await service.getbookingid(req);
            expect(result).toEqual(mockBooking);
            expect(mockRepo.getBookingById).toHaveBeenCalledWith('b1');
        });

        it('throws NotFoundError if booking is not found', async () => {
            mockRepo.getBookingById.mockResolvedValue(null);

            const req = customerRequest('b1');

            await expect(service.getbookingid(req)).rejects.toThrow(NotFoundError);
        });

        it('allows vendor owner of the booking vendor', async () => {
            const mockBooking: Booking = { id: 'b1', customerId: 'c9', vendorId: 'v1' };
            mockRepo.getBookingById.mockResolvedValue(mockBooking);
            operationalAccess.getOperationalAccess.mockResolvedValue({
                role: 'owner',
                vendorId: 'v1',
                active: true,
            });

            const result = await service.getbookingid({
                pathParameters: { bookingId: 'b1' },
                context: { authContext: { userId: 'owner-1' } },
            } as unknown as LambdaRequest);

            expect(result).toEqual(mockBooking);
        });

        it('allows platform admin to read any booking', async () => {
            const mockBooking: Booking = { id: 'b1', customerId: 'c9', vendorId: 'v1' };
            mockRepo.getBookingById.mockResolvedValue(mockBooking);

            const result = await service.getbookingid(adminRequest({
                pathParameters: { bookingId: 'b1' },
            }));
            expect(result).toEqual(mockBooking);
        });
    });

    describe('putbookingid', () => {
        it('rejects direct snapshot changes that would bypass validation', async () => {
            const originalDdb = {
                id: 'b1',
                customerId: 'c1',
                vendorId: 'v1',
                bookingDate: '2026-07-20',
                slotId: 'slot1',
                serviceIds: ['s1'],
                totalAmount: 100,
                bookingStatus: 'PENDING_PAYMENT',
                paymentStatus: 'PENDING',
                version: 1,
                createdAt: '2026-07-13T00:00:00.000Z',
                updatedAt: '2026-07-13T00:00:00.000Z',
                entityType: 'Booking'
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);
            mockRepo.updateBooking.mockResolvedValue();

            const req = {
                ...customerRequest('b1'),
                body: { bookingDate: '2026-07-21', slotId: 'slot2' }
            } as LambdaRequest;

            await expect(service.putbookingid(req)).rejects.toThrow(BusinessRuleError);
            expect(mockRepo.updateBooking).not.toHaveBeenCalled();
        });

        it('permits a note-only update while payment is pending', async () => {
            const originalDdb = { id: 'b1', customerId: 'c1', bookingStatus: 'PENDING_PAYMENT', paymentStatus: 'PENDING', version: 1, bookingDate: '2026-07-20', slotId: 'slot1', serviceIds: [], totalAmount: 100, createdAt: '2026-07-13T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z', entityType: 'Booking' } as any;
            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);
            mockRepo.updateBooking.mockResolvedValue();
            await service.putbookingid({ ...customerRequest('b1'), body: { notes: 'Gate code 1234' } } as LambdaRequest);
            expect(mockRepo.updateBooking).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Gate code 1234' }), originalDdb);
        });

        it('throws BusinessRuleError if booking is in COMPLETED state', async () => {
            const originalDdb = {
                id: 'b1',
                customerId: 'c1',
                bookingStatus: 'COMPLETED',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);

            const req = {
                ...customerRequest('b1'),
                body: { bookingDate: '2026-07-21' }
            } as LambdaRequest;

            await expect(service.putbookingid(req)).rejects.toThrow(BusinessRuleError);
        });
    });

    describe('deletebookingid', () => {
        it('cancels booking successfully', async () => {
            const originalDdb = {
                id: 'b1',
                customerId: 'c1',
                bookingStatus: 'CREATED',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);
            mockRepo.cancelBooking.mockResolvedValue();

            const req = customerRequest('b1');

            await service.deletebookingid(req);
            expect(mockRepo.cancelBooking).toHaveBeenCalledWith(originalDdb);
        });

        it('throws BusinessRuleError if booking is in IN_PROGRESS state', async () => {
            const originalDdb = {
                id: 'b1',
                customerId: 'c1',
                bookingStatus: 'IN_PROGRESS',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);

            const req = customerRequest('b1');

            await expect(service.deletebookingid(req)).rejects.toThrow(BusinessRuleError);
        });
    });

    describe('status transitions', () => {
        it('rejects direct customer confirmation', async () => {
            const originalDdb = {
                id: 'b1',
                customerId: 'c1',
                bookingStatus: 'CREATED',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);
            mockRepo.updateBookingStatus.mockResolvedValue();

            const req = customerRequest('b1');

            await expect(service.postconfirm(req)).rejects.toThrow();
            expect(mockRepo.updateBookingStatus).not.toHaveBeenCalled();
        });

        it('confirms and settles only a matching verified payment', async () => {
            const originalDdb = {
                id: 'b1',
                customerId: 'c1',
                bookingStatus: 'CREATED',
                paymentStatus: 'PENDING',
                totalAmount: 499,
                pricingSnapshot: { totalAmount: 499, currency: 'INR' },
                version: 1,
            } as any;
            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);
            mockRepo.getBookingById.mockResolvedValue({
                ...originalDdb,
                bookingStatus: 'CONFIRMED',
                paymentStatus: 'PAID',
            });
            mockRepo.updateBookingStatus.mockResolvedValue();

            const result = await service.confirmPaidBooking({
                bookingId: 'b1',
                amount: 499,
                currency: 'inr',
            });

            expect(result.bookingStatus).toBe('CONFIRMED');
            expect(mockRepo.updateBookingStatus).toHaveBeenCalledWith('CONFIRMED', originalDdb, 'PAID');
        });

        it('writes an asynchronous confirmation outbox record when a contact snapshot exists', async () => {
            const originalDdb = {
                id: 'b1',
                customerId: 'c1',
                customerEmail: 'customer@example.com',
                customerName: 'Customer One',
                vendorId: 'v1',
                vendorName: 'Vendor One',
                bookingDate: '2026-07-20',
                slotId: 'slot1',
                bookingStatus: 'PENDING_PAYMENT',
                paymentStatus: 'PENDING',
                totalAmount: 499,
                pricingSnapshot: { totalAmount: 499, currency: 'INR' },
                version: 1,
            } as any;
            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);
            mockRepo.getBookingById.mockResolvedValue({ ...originalDdb, bookingStatus: 'CONFIRMED', paymentStatus: 'PAID' });
            mockRepo.updateBookingStatus.mockResolvedValue();

            await service.confirmPaidBooking({ bookingId: 'b1', amount: 499, currency: 'INR' });

            expect(mockRepo.updateBookingStatus).toHaveBeenCalledWith('CONFIRMED', originalDdb, 'PAID', expect.objectContaining({
                eventId: 'Booking.Confirmed:b1',
                idempotencyKey: 'Booking.Confirmed:b1',
                payload: expect.objectContaining({ customerEmail: 'customer@example.com', bookingStatus: 'confirmed' }),
            }));
        });

        it('rejects a mismatched verified payment amount', async () => {
            mockRepo.getBookingDetailsItem.mockResolvedValue({
                id: 'b1',
                customerId: 'c1',
                bookingStatus: 'CREATED',
                paymentStatus: 'PENDING',
                totalAmount: 499,
                pricingSnapshot: { totalAmount: 499, currency: 'INR' },
                version: 1,
            } as any);

            await expect(service.confirmPaidBooking({
                bookingId: 'b1',
                amount: 498,
                currency: 'INR',
            })).rejects.toThrow();
            expect(mockRepo.updateBookingStatus).not.toHaveBeenCalled();
        });

        it('allows valid transition CONFIRMED -> CHECKED_IN', async () => {
            const originalDdb = {
                id: 'b1',
                customerId: 'c1',
                bookingStatus: 'CONFIRMED',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);
            mockRepo.updateBookingStatus.mockResolvedValue();

            const req = customerRequest('b1');

            const result = await service.postcheckin(req);
            expect(result.bookingStatus).toBe('CHECKED_IN');
            expect(mockRepo.updateBookingStatus).toHaveBeenCalledWith('CHECKED_IN', originalDdb);
        });

        it('rejects invalid transition CREATED -> IN_PROGRESS', async () => {
            const originalDdb = {
                id: 'b1',
                customerId: 'c1',
                bookingStatus: 'CREATED',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);

            const req = customerRequest('b1');

            await expect(service.poststart(req)).rejects.toThrow(BusinessRuleError);
        });
    });

    describe('validateBooking schema', () => {
        it('successfully validates payload with vehicleDetails, totalAmount and paymentMethod', () => {
            const rawBody = {
                customerId: "u-e2b72c5b-82aa-497f-bdd2-42c028097126",
                vendorId: "vendor-01",
                vehicleId: "KA05NB4819",
                vehicleDetails: {
                    bodyCategory: "SEDAN",
                    makeModel: "Honda City 2022",
                    saveToGarage: true
                },
                serviceIds: [
                    "srv-detail-01"
                ],
                bookingDate: "2026-07-21T00:00:00.000Z",
                slotId: "slot-2026-07-21-3",
                totalAmount: 609,
                paymentMethod: "CARD"
            };

            const req = { body: rawBody } as unknown as LambdaRequest;
            const parsed = validateBooking(req);
            expect(parsed).toEqual(rawBody);
        });
    });
});
