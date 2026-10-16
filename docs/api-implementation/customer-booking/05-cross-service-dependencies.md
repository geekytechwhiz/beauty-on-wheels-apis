# Cross-service dependencies

```text
customer token -> booking
booking -> vehicle (ownership)
booking -> user (profile/address)
booking -> catalog (offering + authoritative price)
booking -> vendor internal Lambda (branch eligibility)
booking -> availability (hold/slot read, consume/release)
payment webhook -> Payment Service (missing) -> booking internal confirmation
```

The proposed Payment Service must own payment persistence and invoke `booking-service`'s `confirmPaidBooking` Lambda only after signature, event de-duplication, booking amount, and currency checks. It must not read the booking table directly.
