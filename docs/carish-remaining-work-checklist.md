# Carish remaining backend work checklist

Authoritative source: handlers/services/repositories in this repo (not Postman/OpenAPI).
Frontends: sibling `/Applications/Utilities/projects/agent-hub/app-dev/beauty-on-wheels-mobile`.

| ID | Owning service | Current | Consumers | Planned change |
|----|----------------|---------|-----------|----------------|
| **A** Capacity holds | booking-service + vendor-service | Reserve only at payment (`CustomerPlanPaymentsService.activate` → `SoldCapacityService.reservePlanCapacity`). Release Lambda exists but unused. | Customer plan checkout (customer-app); payment callbacks | Hold at payment initiate; convert on paid; release on fail/cancel/expire; late paid → reacquire or refund path |
| **B** Workload units | booking + vendor + catalog | 1 entitlement unit = 1 visit-slot; `durationMinutes` only for crew scheduling | Capacity reserve, commitments | Server-owned minutes→slots mapping from entitlement `durationMinutes`; document unit + backfill note |
| **C** Evidence / payout | booking-service | Evidence bucket + upload-url + review → `payoutEligible` exist; checklist-only still completes as PENDING_REVIEW | partner-app staff completion; ops review | Require evidence when policy requires; verify bucket/CORS/IAM; keep review gate |
| **D** Settlement SoT | vendor-service (+ booking read) | Manual `entries[]` on generate; lifecycle OK | Admin ops; partner settlement views | Auto-build line items from payout-eligible visits + commitment rate; keep mark-paid manual |
| **E** Add-on review | service-catalog-service | Direct vendor POST publishes; UI shows gap banner | AddonSuggestion.tsx | Suggestion entity + ops review; no customer publish until approved |
| **F** Baseline capacity | vendor-service | UI local-only; no API | InitialCapacity.tsx | Optional non-binding preference on vendor; never affects sold capacity |
| **G** Package authoring | service-catalog-service | Vendors can create/patch offerings | ManagerPackages / createProviderOffering | Block vendor create/publish of customer packages; Admin/catalog-only authoring |
| **H** Contracts verify | vendor-service | Capabilities, coverage, proposals, issues largely implemented | partner api-clients | Fix any source gaps; no duplicate work |

Deploy: `dev` stage, `AWS_PROFILE=ci-user-bw`. Never production.
