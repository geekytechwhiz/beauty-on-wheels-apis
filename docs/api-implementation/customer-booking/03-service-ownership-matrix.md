# Service ownership matrix

| Domain | Authoritative owner | Integration used by booking |
| --- | --- | --- |
| Customer identity | identity-v1-service | API Gateway authorizer context |
| Customer profile/address/community | user-service | authenticated HTTP |
| Vehicle ownership | vehicle-service | authenticated HTTP |
| Offerings/pricing | service-catalog-service | authenticated HTTP |
| Vendor/branch eligibility | vendor-service | direct Lambda invoke |
| Slots, holds, allocations | availability-service | HTTP reads plus direct Lambda invoke |
| Booking record | booking-service | owned DynamoDB table |
| Payment | missing | must be a new owning service; never access booking data directly |

Booking Service does not directly access another service's DynamoDB table.
