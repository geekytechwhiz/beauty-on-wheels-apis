export interface VehicleDdbItem {
  PK: string;
  SK: string;
  vehicleId: string;
  userId: string;
  registrationNumber: string;
  vehicleType: 'HATCHBACK' | 'SEDAN' | 'SUV' | 'MUV' | 'LUXURY' | 'BIKE';
  brand?: string;
  model?: string;
  variant?: string;
  fuelType?: 'PETROL' | 'DIESEL' | 'EV' | 'HYBRID' | 'CNG';
  manufactureYear?: number;
  color?: string;
  status: 'ACTIVE' | 'INACTIVE';
  defaultVehicle: boolean;
  createdAt: string;
  updatedAt: string;
  LSI1SK: string;
  LSI2SK: string;
  LSI3SK: string;
  entityType: 'Vehicle';
}
