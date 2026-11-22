## Package plan journey: customer to vendor and back

A package plan is the **customer’s purchase and entitlement** for a defined period. Each included service visit is tracked as a separate **package visit**. A visit being paid for does not mean it has been scheduled or completed.

### 1. Customer buys the package

The customer chooses an offering and submits:

```http
POST /customer-plans
```

The plan is created as `PENDING_PAYMENT`. Its duration, included visits, and cadence come from the selected package and request. At this point, the customer can see the plan and payment state, but the visits are not yet available as paid entitlements.

The customer completes payment through the plan payment endpoints. After payment is confirmed, the plan is activated and its included package visits can be listed:

```http
GET /customer-plans/{planId}/visits
```

That response is where the customer app gets each `visitId`. The customer should not generate those IDs.

### 2. Vendor schedules each visit

The vendor views package visits for their work queue:

```http
GET /vendors/{vendorId}/package-visits
```

An unscheduled visit has no service date or reserved slot. The vendor selects the date and window, then schedules it:

```http
POST /customer-plans/{planId}/visits/{visitId}/schedule
```

This reserves availability and changes the visit to `SCHEDULED`. The visit can then appear in the vendor’s date-based schedule, including the GSI3 access pattern.

If the date or slot needs to change later:

```http
POST /customer-plans/{planId}/visits/{visitId}/reschedule
```

### 3. Vendor assigns the visit to a crew

Scheduling and crew assignment are separate. After scheduling, the vendor manager assigns one or more visits to a crew:

```http
PUT /vendors/{vendorId}/package-visits/assignments
```

The crew sees its assigned jobs through:

```http
GET /staff/me/package-visits
```

### 4. Crew performs and completes the visit

The crew starts the assigned visit:

```http
POST /staff/me/package-visits/{visitId}/start
```

The visit moves from `SCHEDULED` to `IN_PROGRESS`. After the service, the crew submits the required checklist and any configured evidence:

```http
POST /staff/me/package-visits/{visitId}/complete
```

The visit becomes `COMPLETED`; the entitlement is consumed once. The API contract says completion is initially `PENDING_REVIEW`, and payout eligibility waits for operations approval.

### 5. Customer tracks package and visits

The customer can list plans:

```http
GET /customer-plans
```

Then fetch a plan and its visits:

```http
GET /customer-plans/{planId}
GET /customer-plans/{planId}/visits
```

The customer app should show the plan’s overall state and the state of each included visit separately—for example, **unscheduled**, **scheduled**, **in progress**, **completed**, or **missed/cancelled** if those states are returned by the API. The customer can see which visits remain and their scheduled dates; the crew or vendor service records the operational progress.

### How package duration should be understood

The package configuration defines the **validity period**, included visit count, and cadence. Each visit is then individually scheduled and completed during that period. The API description indicates plan payment activates the plan, while starting a visit may also activate the parent plan; confirm the service’s exact start-date rule before presenting an expiry date. In particular, decide whether the duration begins on **payment confirmation** or on the **first service** and use that same rule in the plan record and customer UI.

**In short:** customer purchases the plan → payment is confirmed → visit entitlements are listed → vendor schedules each visit → manager assigns a crew → crew starts and completes it → customer tracks the plan and each visit through its lifecycle.