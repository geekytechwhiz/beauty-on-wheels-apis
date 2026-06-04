Template Hierarchy, Org Template, Structure Change, and Care Plan Creation Addendum

Requirements for Platform Masters, Org Masters, Org-owned Templates, Org Care Plans, structure change impact, and package-linkable care plans

1. Executive Summary

Template Service owns design-time structures: Platform Masters, Org Masters, Org-owned Templates, and Org Care Plans.

Platform Masters are created and governed by Super Admin/platform. They define base structure, controls, metadata-backed fields, allowed features/modules, and template behavior.

Org Masters are derived/enabled from Platform Masters for one organization. They are org-scoped starting points and remain non-package-linkable.

From Org Masters, orgs may create their own Org Templates. These are org-owned reusable templates that allow the org to configure controls, allowed sections, default values, selected metadata, and reusable program structure within platform guardrails.

Org Templates are then used to create actual Org Care Plans by duration/version, such as Diabetes 90 Days v1 or Hypertension 30 Days v1.

Only published Org Care Plans are package-linkable. Platform Masters, Org Masters, Org Templates, drafts, in-review items, inactive items, and cross-org records are not package-linkable.

Template structure/design changes are separate from metadata changes and shall be handled through template versioning, ChangeSet/Diff, Upgrade Available, and explicit adoption.

Existing published care plans, package links, and patient runtime records remain pinned unless an explicit version upgrade or runtime migration workflow is performed.

2. Required Hierarchy

2.1 Conceptual Flow

Platform Program Master
   ↓ enabled/derived for org
Org Program Master
   ↓ org creates reusable templates
Org-owned Template
   ↓ org creates publishable care plans
Org Care Plan by duration/version
   ↓ package linking
Patient package assignment / runtime snapshot

3. Key Concept: Org Templates Between Org Master and Care Plan

The hierarchy must explicitly support org-owned templates between Org Master and final Org Care Plan. This gives organizations a controlled way to build their own reusable program templates before creating multiple duration/version-specific care plans.

4. UX Labels and Lists

5. Required Data Model Fields / Confirmations

6. Care Plan Creation Flow

1. Super Admin creates and publishes a Platform Program Master, for example Diabetes Master v1.

2. Super Admin enables/derives the Platform Master for an org, creating ABC Diabetes Org Master v1.

3. Org Admin creates an Org Template from ABC Diabetes Org Master v1, for example ABC Diabetes Standard Template v1.

4. Org Admin customizes the Org Template within allowed controls. This may include tasks, goals, monitoring, symptoms, thresholds/alerts, follow-up guidance, and display behavior.

5. Org Admin creates actual Org Care Plans from the Org Template, such as Diabetes 90 Days v1 and Diabetes 180 Days v1.

6. Only published Org Care Plans appear in package linking.

7. Package Assignment sends LinkedOrgCarePlanVersionID to Care Plan Runtime when a patient is assigned the package.

6.1 Single Care Plan Builder

Org users should not be forced to manually create and link Goal, Task, Monitoring, Symptom, Threshold, and Alert templates each time. The builder should look like one flow while Template Service may store internal component snapshots or linked template records.

7. Template Structure / Design Change Trigger

Template structure/design changes are owned by Template Service and are separate from metadata changes. They occur when the template model, control behavior, or linked structure changes independent of Metadata Registry data updates.

8. ChangeSet / Diff and Upgrade Available

When a Platform Master or Org Master structure changes, Template Service shall generate a ChangeSet/Diff. UI must show the org what changed and what customizations will be preserved before adoption.

8.1 Upgrade Flow

Platform Diabetes Master v2 published
   ↓
Impacted orgs marked UpgradeAvailable
   ↓
Org Admin reviews ChangeSet/Diff
   ↓
Org adopts into new Org Master version
   ↓
Existing Org Templates and Org Care Plans remain unchanged unless org creates new versions
   ↓
New/future care plans may use the newer org master/template version

9. Org Customization Preservation Rules

Org-created templates and care plans must not be overwritten by platform master upgrades.

Adoption creates a new version; it does not update existing published Org Templates or Org Care Plans in place.

Org-specific task lists, goals, monitoring choices, symptoms, thresholds/alerts, and follow-up guidance must be preserved unless the org explicitly changes them in a new draft/version.

If a platform change conflicts with an org customization, the system must show ManualReview or Block in the ChangeSet/Diff depending on policy.

Published templates/care plans remain immutable. Editing requires clone/new version in Saved/Draft state.

10. Package Linking Rules

11. Example Scenarios

11.1 Diabetes Program Setup

Platform Master: Diabetes Master v1
   ↓ enabled for ABC Hospital
Org Master: ABC Diabetes Master v1
   ↓ org creates reusable template
Org Template: ABC Diabetes Standard Template v1
   ↓ org creates care plans
Org Care Plans:
  - Diabetes 90 Days v1
  - Diabetes 180 Days v1
   ↓ package links to Diabetes 90 Days v1

11.2 Hypertension Upgrade

Platform Hypertension Master v2 adds caregiver task support
   ↓
ABC sees Upgrade Available
   ↓
ABC adopts to create ABC Hypertension Master v2
   ↓
ABC may create Hypertension Standard Template v2
   ↓
ABC creates Hypertension 30 Days v2
   ↓
Package may be manually relinked for future assignments

12. Acceptance Criteria

Given Super Admin publishes a Platform Master, when it is enabled for an org, then the system shall create or update an Org Master preserving SourcePlatformMasterVersionID.

Given an Org Master exists, when Org Admin creates an Org Template, then the system shall create an org-owned draft that can be modified only within allowed controls.

Given an Org Template exists, when Org Admin creates an Org Care Plan, then the system shall allow configuration of actual care plan details including duration, goals, monitoring, tasks, symptoms, thresholds/alerts, and follow-up.

Given an Org Care Plan is published, when Package Linking opens, then only published Org Care Plans with IsPackageLinkable = True shall appear.

Given a new Platform Master version is published, when an org has existing templates/care plans, then the system shall show Upgrade Available and ChangeSet/Diff without overwriting org-owned templates or care plans.

Given an org adopts a new master version, then a new Org Master version shall be created and existing published care plans, package links, and runtime records shall remain unchanged.

Given an org wants new behavior in an existing program, when the org updates its reusable Org Template, then the system shall create a new version and require new/published Org Care Plans for package linking.

13. Implementation Sequence

1. Confirm TemplateLevel values and lineage fields across Platform Master, Org Master, Org Template, and Org Care Plan.

2. Add/confirm IsPackageLinkable behavior: true only for published Org Care Plans.

3. Add stable SectionKey, FieldKey, LinkKey, and ValueKey for diff/merge support.

4. Update UI navigation to show Org Masters, Org Templates, and My Care Plans separately.

5. Implement Org Template creation from Org Master with controls enforced.

6. Implement Org Care Plan creation from Org Template through a single Care Plan Builder.

7. Implement ChangeSet/Diff generation for template structure/version comparisons.

8. Implement Upgrade Available and adoption workflow that creates new versions without overwriting org content.

9. Update Package Linking filters to show only published Org Care Plans and validate Org Capability Profile readiness.

14. Open Decisions