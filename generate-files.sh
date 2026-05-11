#!/bin/bash

# ==========================================
# Alert Core Event Structure Generator
# ==========================================

ROOT="libs/alert-core/src"

echo "Creating Alert Core structure..."

# ==========================================
# EVENTS
# ==========================================

mkdir -p $ROOT/events/inbound
mkdir -p $ROOT/events/outbound
mkdir -p $ROOT/events/internal

# ==========================================
# STEP 4 - INBOUND EVENTS
# ==========================================

touch $ROOT/events/inbound/threshold-breach.event.ts
touch $ROOT/events/inbound/missed-reading.event.ts
touch $ROOT/events/inbound/missing-device.event.ts
touch $ROOT/events/inbound/symptom-risk.event.ts
touch $ROOT/events/inbound/engagement-trigger.event.ts

# ==========================================
# STEP 5 - OUTBOUND EVENTS
# ==========================================

touch $ROOT/events/outbound/alert-created.event.ts
touch $ROOT/events/outbound/alert-assigned.event.ts
touch $ROOT/events/outbound/alert-resolved.event.ts
touch $ROOT/events/outbound/alert-dismissed.event.ts
touch $ROOT/events/outbound/alert-sla-breached.event.ts

# ==========================================
# STEP 6 - INTERNAL EVENTS
# ==========================================

touch $ROOT/events/internal/group-reopened.event.ts
touch $ROOT/events/internal/group-created.event.ts
touch $ROOT/events/internal/group-assigned.event.ts
touch $ROOT/events/internal/sla-breached.event.ts
touch $ROOT/events/internal/activity-created.event.ts

# ==========================================
# STEP 8 - POLICIES
# ==========================================

# mkdir -p $ROOT/policies

# touch $ROOT/policies/priority-policy.service.ts
# touch $ROOT/policies/assignment-policy.service.ts
# touch $ROOT/policies/grouping-policy.service.ts
# touch $ROOT/policies/sla-policy.service.ts

# # ==========================================
# # STEP 9 - GROUPING
# # ==========================================

# mkdir -p $ROOT/grouping

# touch $ROOT/grouping/grouping-key.builder.ts
# touch $ROOT/grouping/grouping-resolver.service.ts
# touch $ROOT/grouping/grouping-strategy.ts

# # ==========================================
# # BONUS STRUCTURE
# # ==========================================

# mkdir -p $ROOT/domain/entities
# mkdir -p $ROOT/domain/value-objects
# mkdir -p $ROOT/domain/enums

# mkdir -p $ROOT/lifecycle
# mkdir -p $ROOT/sla
# mkdir -p $ROOT/contracts
# mkdir -p $ROOT/validators
# mkdir -p $ROOT/errors
# mkdir -p $ROOT/services

# # ==========================================
# # DOMAIN FILES
# # ==========================================

# touch $ROOT/domain/entities/alert.entity.ts
# touch $ROOT/domain/entities/alert-group.entity.ts
# touch $ROOT/domain/entities/alert-activity.entity.ts

# touch $ROOT/domain/value-objects/grouping-key.vo.ts
# touch $ROOT/domain/value-objects/alert-summary.vo.ts
# touch $ROOT/domain/value-objects/sla-window.vo.ts

# touch $ROOT/domain/enums/alert-state.enum.ts
# touch $ROOT/domain/enums/alert-priority.enum.ts
# touch $ROOT/domain/enums/input-type.enum.ts
# touch $ROOT/domain/enums/activity-type.enum.ts

# ==========================================
# LIFECYCLE
# ==========================================

# touch $ROOT/lifecycle/lifecycle-machine.ts
# touch $ROOT/lifecycle/transition-validator.ts

# # ==========================================
# # SLA
# # ==========================================

# touch $ROOT/sla/sla-calculator.ts
# touch $ROOT/sla/sla-breach-detector.ts

# # ==========================================
# # CONTRACTS
# # ==========================================

# touch $ROOT/contracts/alert-repository.contract.ts
# touch $ROOT/contracts/event-publisher.contract.ts
# touch $ROOT/contracts/clock.contract.ts

# # ==========================================
# # VALIDATORS
# # ==========================================

# touch $ROOT/validators/threshold-breach.validator.ts
# touch $ROOT/validators/evidence.validator.ts
# touch $ROOT/validators/grouping.validator.ts

# # ==========================================
# # ERRORS
# # ==========================================

# touch $ROOT/errors/invalid-alert-input.error.ts
# touch $ROOT/errors/invalid-transition.error.ts
# touch $ROOT/errors/duplicate-event.error.ts

# # ==========================================
# # SERVICES
# # ==========================================

# touch $ROOT/services/alert-creation.service.ts
# touch $ROOT/services/alert-summary.service.ts
# touch $ROOT/services/activity.service.ts

echo "✅ Alert Core structure created successfully."