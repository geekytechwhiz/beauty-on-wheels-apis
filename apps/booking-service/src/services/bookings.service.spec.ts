import { BookingsService } from './bookings.service';
import { BookingsRepository } from '../repositories/bookings.repository';
import { Booking } from '../types/api-types';
import { LambdaRequest } from '@api-hub/utils';
import { ValidationError, ConflictError, NotFoundError, BusinessRuleError, ConditionalWriteConflictError } from '@api-hub/utils';

describe('BookingsService Unit Tests', () => {
    let mockRepo: jest.Mocked<BookingsRepository>;
    let service: BookingsService;

    beforeEach(() => {
        mockRepo = {
            getBookingById: jest.fn(),
            getBookingDetailsItem: jest.fn(),
            createBooking: jest.fn(),
            getCustomerBookings: jest.fn(),
            getVendorBookings: jest.fn(),
            listAllBookings: jest.fn(),
            updateBooking: jest.fn(),
            updateBookingStatus: jest.fn(),
            cancelBooking: jest.fn(),
            bookingExists: jest.fn()
        } as unknown as jest.Mocked<BookingsRepository>;

        service = new BookingsService(mockRepo);
    });

    describe('getbookings', () => {
        it('queries customer bookings if customerId is present', async () => {
            const mockBookings: Booking[] = [{ id: 'b1', customerId: 'c1', bookingStatus: 'CREATED' }];
            mockRepo.getCustomerBookings.mockResolvedValue(mockBookings);

            const result = await service.getbookings({ customerId: 'c1' });
            expect(result).toEqual(mockBookings);
            expect(mockRepo.getCustomerBookings).toHaveBeenCalledWith('c1');
        });

        it('queries vendor bookings if vendorId is present', async () => {
            const mockBookings: Booking[] = [{ id: 'b1', vendorId: 'v1', bookingStatus: 'CREATED' }];
            mockRepo.getVendorBookings.mockResolvedValue(mockBookings);

            const result = await service.getbookings({ vendorId: 'v1' });
            expect(result).toEqual(mockBookings);
            expect(mockRepo.getVendorBookings).toHaveBeenCalledWith('v1');
        });

        it('lists all bookings if no customerId or vendorId is present', async () => {
            const mockBookings: Booking[] = [{ id: 'b1', bookingStatus: 'CREATED' }];
            mockRepo.listAllBookings.mockResolvedValue(mockBookings);

            const result = await service.getbookings({});
            expect(result).toEqual(mockBookings);
            expect(mockRepo.listAllBookings).toHaveBeenCalled();
        });
    });

    describe('postbookings', () => {
        it('creates a booking successfully', async () => {
            const input: Booking = {
                customerId: 'c1',
                vendorId: 'v1',
                bookingDate: '2026-07-20',
                slotId: 'slot1',
                serviceIds: ['s1'],
                totalAmount: 100
            };
            const createdBooking = { ...input, id: 'b1', bookingStatus: 'CREATED', paymentStatus: 'PENDING' };
            mockRepo.createBooking.mockResolvedValue(createdBooking);

            const req = {
                body: input
            } as unknown as LambdaRequest;

            const result = await service.postbookings(req);
            expect(result).toEqual(createdBooking);
            expect(mockRepo.createBooking).toHaveBeenCalled();
        });

        it('throws ValidationError if customerId is missing', async () => {
            const input: Booking = {
                vendorId: 'v1',
                bookingDate: '2026-07-20',
                slotId: 'slot1',
                serviceIds: ['s1'],
                totalAmount: 100
            };
            const req = { body: input } as unknown as LambdaRequest;

            await expect(service.postbookings(req)).rejects.toThrow(ValidationError);
        });

        it('throws ConflictError on ConditionalWriteConflictError from repository', async () => {
            const input: Booking = {
                customerId: 'c1',
                vendorId: 'v1',
                bookingDate: '2026-07-20',
                slotId: 'slot1',
                serviceIds: ['s1'],
                totalAmount: 100
            };
            mockRepo.createBooking.mockRejectedValue(new ConditionalWriteConflictError('Slot locked'));

            const req = { body: input } as unknown as LambdaRequest;

            await expect(service.postbookings(req)).rejects.toThrow(ConflictError);
        });
    });

    describe('getbookingid', () => {
        it('returns booking if found', async () => {
            const mockBooking: Booking = { id: 'b1', customerId: 'c1' };
            mockRepo.getBookingById.mockResolvedValue(mockBooking);

            const req = {
                pathParameters: { bookingId: 'b1' }
            } as unknown as LambdaRequest;

            const result = await service.getbookingid(req);
            expect(result).toEqual(mockBooking);
            expect(mockRepo.getBookingById).toHaveBeenCalledWith('b1');
        });

        it('throws NotFoundError if booking is not found', async () => {
            mockRepo.getBookingById.mockResolvedValue(null);

            const req = {
                pathParameters: { bookingId: 'b1' }
            } as unknown as LambdaRequest;

            await expect(service.getbookingid(req)).rejects.toThrow(NotFoundError);
        });
    });

    describe('putbookingid', () => {
        it('updates booking details successfully if in allowed state', async () => {
            const originalDdb = {
                id: 'b1',
                customerId: 'c1',
                vendorId: 'v1',
                bookingDate: '2026-07-20',
                slotId: 'slot1',
                serviceIds: ['s1'],
                totalAmount: 100,
                bookingStatus: 'CREATED',
                paymentStatus: 'PENDING',
                version: 1,
                createdAt: '2026-07-13T00:00:00.000Z',
                updatedAt: '2026-07-13T00:00:00.000Z',
                entityType: 'Booking'
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);
            mockRepo.updateBooking.mockResolvedValue();

            const req = {
                pathParameters: { bookingId: 'b1' },
                body: { bookingDate: '2026-07-21', slotId: 'slot2' }
            } as unknown as LambdaRequest;

            const result = await service.putbookingid(req);
            expect(result.bookingDate).toBe('2026-07-21');
            expect(result.slotId).toBe('slot2');
            expect(mockRepo.updateBooking).toHaveBeenCalled();
        });

        it('throws BusinessRuleError if booking is in COMPLETED state', async () => {
            const originalDdb = {
                id: 'b1',
                bookingStatus: 'COMPLETED',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);

            const req = {
                pathParameters: { bookingId: 'b1' },
                body: { bookingDate: '2026-07-21' }
            } as unknown as LambdaRequest;

            await expect(service.putbookingid(req)).rejects.toThrow(BusinessRuleError);
        });
    });

    describe('deletebookingid', () => {
        it('cancels booking successfully', async () => {
            const originalDdb = {
                id: 'b1',
                bookingStatus: 'CREATED',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);
            mockRepo.cancelBooking.mockResolvedValue();

            const req = {
                pathParameters: { bookingId: 'b1' }
            } as unknown as LambdaRequest;

            await service.deletebookingid(req);
            expect(mockRepo.cancelBooking).toHaveBeenCalledWith(originalDdb);
        });

        it('throws BusinessRuleError if booking is in IN_PROGRESS state', async () => {
            const originalDdb = {
                id: 'b1',
                bookingStatus: 'IN_PROGRESS',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);

            const req = {
                pathParameters: { bookingId: 'b1' }
            } as unknown as LambdaRequest;

            await expect(service.deletebookingid(req)).rejects.toThrow(BusinessRuleError);
        });
    });

    describe('status transitions', () => {
        it('allows valid transition CREATED -> CONFIRMED', async () => {
            const originalDdb = {
                id: 'b1',
                bookingStatus: 'CREATED',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);
            mockRepo.updateBookingStatus.mockResolvedValue();

            const req = {
                pathParameters: { bookingId: 'b1' }
            } as unknown as LambdaRequest;

            const result = await service.postconfirm(req);
            expect(result.bookingStatus).toBe('CONFIRMED');
            expect(mockRepo.updateBookingStatus).toHaveBeenCalledWith('CONFIRMED', originalDdb);
        });

        it('allows valid transition CONFIRMED -> CHECKED_IN', async () => {
            const originalDdb = {
                id: 'b1',
                bookingStatus: 'CONFIRMED',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);
            mockRepo.updateBookingStatus.mockResolvedValue();

            const req = {
                pathParameters: { bookingId: 'b1' }
            } as unknown as LambdaRequest;

            const result = await service.postcheckin(req);
            expect(result.bookingStatus).toBe('CHECKED_IN');
            expect(mockRepo.updateBookingStatus).toHaveBeenCalledWith('CHECKED_IN', originalDdb);
        });

        it('rejects invalid transition CREATED -> IN_PROGRESS', async () => {
            const originalDdb = {
                id: 'b1',
                bookingStatus: 'CREATED',
                version: 1
            } as any;

            mockRepo.getBookingDetailsItem.mockResolvedValue(originalDdb);

            const req = {
                pathParameters: { bookingId: 'b1' }
            } as unknown as LambdaRequest;

            await expect(service.poststart(req)).rejects.toThrow(BusinessRuleError);
        });
    });
});
