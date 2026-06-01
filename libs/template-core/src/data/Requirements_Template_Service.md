



 

CONCEPT OF TEMPLATE ARCHITECTURE

Template Engine Concept

 

A Template is a structured, versioned design-time configuration artifact used to define reusable clinical and operational building blocks for care programs. A template does not hold patient-specific runtime data. Instead, it defines the structure, allowed values, defaults, linking, and downstream control rules that will later be used to create org-specific templates and, through other runtime services, actual patient-facing workflows.



The Template Service provides the design-time foundation for the care continuity platform. Its primary purpose is to let the platform define reusable master templates, allow orgs to derive controlled org-specific versions, and keep all such configurations versioned, traceable, and compatible. The current core use case is creation of Care Plan templates, but the same framework is intentionally designed to support broader extensibility over time.

The overall workflow is:

Metadata Registry defines reusable metadata types and values. 

Platform creates Master Templates for a template profile (for example: CarePlan + Chronic Disease + Hypertension + US). 

Org Templates are derived from published Master Template versions and configured by the platform based on the modules, features, and controls enabled for that organization. The organization can then create and maintain its own template variants within the allowed control rules.

Downstream runtime services consume the published org template for execution-related use cases outside the scope of this service. 



Templates are designed as reusable building blocks. Where supported, one template may link to another template type instead of redefining the same logic inline. This allows Care Plan templates to coordinate linked Goal, Task, Monitoring, Symptom/Questionnaire, Threshold, Alert Policy, Billing Reference, and optional OKR templates.  while keeping each building block independently versioned and reusable.



This separation is intentional. It allows the platform to keep reusable building blocks independent, linked, and versioned. For example:

Care Plan may link to Goal Template and, where enabled, optional OKR Template.

a Symptom Template can be reused across care plans and may also be used to drive survey-style forms 

a Threshold Template can define monitoring rules independently of the Alert Policy Template that governs routing and response behavior 

Task Templates can remain reusable across multiple OKR or Care Plan designs 



This model improves reuse, reduces duplication, and allows controlled change. A single linked template can evolve independently through versioning, while downstream templates explicitly choose when to adopt a newer version. It also supports extensibility: new care programs, new conditions, additional questionnaires/surveys, new monitoring models, and future capabilities such as ePrescription-related templates or medication workflows can follow the same pattern without redesigning the service.



For the current phase, Care Plan is the primary orchestration template. It acts as the central template type that brings together the relevant building blocks for a specific clinical program. A Care Plan template is expected to reference and coordinate linked templates such as:

OKR Template 



Task Template 

Symptom Template 

Threshold Template 

Alert Policy Template 



Each template has internal structure. At a high level, a template is organized into sections, and sections may contain entries, fields, values, and links. Some sections are mandatory, some optional. Some fields are metadata-driven, while others define direct field constraints such as numeric ranges, text limits, or booleans. Where applicable, templates also define downstream control behavior using the common control mechanism for:

Add 

Remove 

Update 

Min 

Max 

MetadataMode 

This makes the Template Service both structured and extensible: strict enough to maintain consistency, but flexible enough to support controlled variation at org level and future expansion of the platform.

 

Template Types Managed by Template Service

 

The following template types must be supported:

Care Plan Master Template 

Goal Master Template

Monitoring Master Template

OKR Master Template 

Task Master Template 

Symptom Master Template

Threshold Template

Alert Template

 

All template types are managed within the same Template Service, but each template type is versioned and governed independently.

Template Hierarchy

 

Platform Master Templates

(Owned by MyVitalRx / Platform)



        ↓



Org-Specific Templates

(Owned by individual orgs; derived from published Master Template versions)



        ↓



Referenced by downstream runtime services

(out of scope for this service)



Platform Master Templates are reusable platform-owned templates. 

Org Templates are owned and versioned independently by the org after derivation.

Sharing behavior, where supported, must be defined explicitly using ShareScope and must not be inferred from OwnerOrgID.

Templates may be introduced into the system through one of the following modes:

new Master Template creation by platform 

derivation from a published Master Template version 

cloning of an existing template version into a new draft/version 



Structural Authority Model



Each template type is independently versioned.

Templates are governed across three levels:





Rules:

Platform Master Template defines the base structure for derived Org Templates. 

Org Template may only modify structure, values, defaults, and extensions where allowed by the common control mechanism defined in 3.2

Runtime does not modify template design. Runtime services only consume published templates and may apply runtime overrides only where explicitly supported. 

Protected schema elements remain platform-controlled unless explicitly stated otherwise.

SCOPE OF TEMPLATE SERVICE

In Scope

The Template Service must:

Store and version master templates. 

Store and version org templates. 

Enforce compatibility constraints. 

Enforce mandatory/optional rules. 

Manage structural definitions. 

Manage linking rules between template types. 

Maintain audit trail. 

Support country-level filtering. 

Support language metadata. 

Consume metadata values from the Metadata Registry during template design. 

Filter selectable metadata values based on template context: 

Template Type 

Category 

Condition 

Country 

Store selected metadata values in master and org templates where applicable. 

Store default values in master and org templates where applicable.

Apply the common control mechanism to configurable sections, entries, and parameters. 

 

Out of Scope <Refer to other service requirements>

Package linking. 

Consent management. 

Risk scoring. 

Patient enrollment. 

Task execution. 

Alert runtime handling. 

Runtime workflow execution. 

Runtime plan usage and patient-level workflow behavior.

Billing eligibility calculation, CPT rule execution, and billing export are owned by the Billing Service and are out of scope for Template Service.

COMMON TEMPLATE STRUCTURE (APPLIES TO ALL TEMPLATE TYPES)

All templates (all types) must contain the following metadata. 

Template Control Mechanism

The common control mechanism defines downstream behavior for configurable template entities and field values. It applies only where relevant and separates:

structural control 

direct-value field behavior 

metadata-driven field behavior



Control Targets



Structural Control Attributes

Structural control defines what the next level may do with Sections, Entries, Fields, and Links.







 



 Value / Metadata Control Attributes

Value control defines how field values behave at the next level. For any field, value behavior must be defined based on whether the field is:

direct-value driven
or 

metadata-driven 



Direct-value fields

Examples:

numeric field 

text field 

boolean field 

date field



Such fields may define:







For non-metadata-backed fields, define applicable Field constraints as:





Rules

Downstream editability of direct-value fields is governed by the common Update control. 

Mandatory and field constraints are fixed unless explicit downstream override is defined. 

If downstream behavior is not explicitly defined, the default is No.



Metadata-driven fields

Examples:

Duration Type 

Review Cadence 

Device 

Question Type 

Such fields must define:



MetadataMode applies only to metadata-driven fields.





Rules

ValueDataType, MultiSelectAllowed, and AttributeSchema are defined at Metadata Registry level. Template-specific usage of metadata is defined here.

All configurable template entities must use the common control mechanism where applicable. 

If a control is not explicitly defined, the default value applies. 

Update governs downstream editability unless a more specific exception is explicitly defined. 

Structural schema elements such as DataType, linking model, severity taxonomy, and dedup model remain platform-controlled unless explicitly stated otherwise. 

Controls should be defined only where relevant. Later sections should define overrides only where needed and must not restate default behavior.









Display Control





Display should control visibility/location, not editability.

Main = Visible and User must be able to add / select value

Settings = Shown in Settings screen. Usually control attributes

System = Must be shown but not while create/Edit. Shown in History or in Review etc.

Hidden must be specifically mentioned otherwise its always shown

If Display is not defined:

treat it as System and Hidden depending on your preference

COMMON ENTITY TARGETING AND LINKING MODEL

Purpose

This section defines the common entity-targeting model used across templates wherever the platform must identify what exact thing is being tracked, evaluated, or linked.

This model must be used consistently in:

OKR Template, where enabled

Symptom/Questionnaire Template 

Threshold Template 

Alert Policy Template 

Metadata Registry 

Linking & Compatibility Rules

Goal Template

Monitoring Template


 

Filtering and Resolution Logic

Where filtering, lookup, or derived resolution is required, the system must use:

AppliesToType + LinkedEntityCode

This combination is the standard matching input across templates and downstream resolution.

 

Where this model is used



 

Examples



Common Metadata

 





A template is uniquely defined by:

Template Type 

Category 

Condition 

Country 

Version 

For platform master templates, this template profile must be defined upfront and used consistently across the service.



Linking /Reference and MasterTemplateVersionID:-



Each Template Type Has Its Own Lineage

The Care Plan template does NOT store the MasterTemplateVersionID of the OKR template.

CarePlan template → references CarePlan master 

OKR template → references OKR master 

Symptom template → references Symptom master 

Threshold template → references Threshold master 

Example: Platform Master Templates

CarePlan Master v1 → ID = CP-M-001 

OKR Master v3 → ID = OKR-M-003 

Symptom Master v2 → ID = SYM-M-002 

Org A Creates Derived Templates

CarePlan Org Template → MasterTemplateVersionID = CP-M-001 

OKR Org Template → MasterTemplateVersionID = OKR-M-003 

Symptom Org Template → MasterTemplateVersionID = SYM-M-002 

At Care Plan Linking Level

When Care Plan links OKR:

It stores:

Linked OKRTemplateVersionID

That is a reference to the specific OKR template version being used.  We will define these later in each templates which links to other.

That OKR template itself may have:

MasterTemplateVersionID



Versioning Rules (Common to All Templates)



Each template must maintain its own independent version history. 

Only one Published version may exist for a given template profile at a time. 

A template profile is defined by: 

Template Type 

Category 

Condition 

Country 

Published templates are immutable. 

Editing a published template requires creation of a new version in Saved state. 

When a new version is published: 

previous published version automatically becomes Inactive. 

Saved and In Review states do not change the active published version. 

Version history must be retrievable. 

Versioning must follow below logic:

Template versions shall use an auto-incremented integer Version field, and may be displayed using a short identifier format such as <TemplateTypeShort>-<DomainShort>-v<Version> for human-readable reference.

<TemplateTypeShort>-<DomainShort>-v<Version>

Template type short codes

CP = Care Plan 

OKR = OKR 



TSK = Task 

SYM = Symptom 

THR = Threshold 

ALT = Alert Policy 

Examples

CP-HTN-v1 = Hypertension Care Plan version 1 

OKR-HTN-v2 = Hypertension OKR version 2 

TSK-BPREAD-v1 = BP Reading Task version 1 

SYM-PAIN-v3 = Pain Symptom Template version 3 

THR-BPSYS-v1 = BP Systolic Threshold version 1 

ALT-VITALS-v1 = Vitals Alert Policy version 1

 

New Version Required When -- Refer to Section 12.7 for more details

A new version is required when any of the following changes occur:

Structural changes: 

section added/removed 

parameter added/removed 

section control changed 

limits (Max) changed 

Linking changes: 

linked template version changed 

linking rule changed 

Selected metadata values change for any field/entity with MetadataMode = Fixed 

Default value changes 

MetadataMode changes 

Any business rule or constraint that changes template behavior 

 

New Version Not Required When

A new version is not required when:

New metadata values become available under MetadataMode = Expandable 

 

Additional Rule

Changes to audit metadata only do not require creation of new template version. 

Examples:

LastModifiedBy 

LastModifiedDate 

maybe internal system timestamps



Status Transition Constraints

Allowed transitions:

Saved → In Review 

Saved -> Deleted

In Review → Saved

In Review -> Deleted 

In Review → Published 

Published → Inactive (automatic when new version published) 

Constraints:

Until a template is published, it may be updated in place. 

A published template cannot be edited in place. Editing requires cloning into a new version in Saved state. 

Only Published templates may be referenced by other templates. 

A template in Saved or In Review state must not be used for runtime derivation or linking. 

If the template profile already has a published version, publishing a new version automatically

 inactivates the previous published version.

A template may be deleted only until it is published. Once published, it must not be deleted and must instead be versioned, archived, or marked Inactive as applicable. 

 

Section Definition Model

Each template may contain multiple sections.

Each section must define:



 

Rules

Downstream behavior for sections is governed by the common control mechanism defined in 3.1.

CARE PLAN MASTER TEMPLATE – DETAILED REQUIREMENTS

 	

Care Plan Core Attributes

This section defines the core configuration of a Care Plan Template, including duration, goal/OKR enablement, and billing program applicability. These attributes control which sections are enabled and how the care plan behaves across different use cases (e.g., US RPM, India chronic care).



 





Constraints

Care Plan duration must not exceed the duration supported by the linked package. 

Custom Duration cannot be enabled without platform flag. 

At least one of GoalEnabled or OKREnabled must be True. 

If BillingProgramType = None, no billing program reference is required.

 

Care Plan Sections

Care Plan must support the following sections.









Care Plan Task Linkage (Optional)





This section defines the only supported template-level linkage for reusable Task Templates in the current model.
A Care Plan may link one or more published Task Template Versions for patient-facing or staff-facing care-plan actions such as onboarding, setup, education, compliance, formal review preparation, ongoing care actions, and closure-related actions.

Each Care Plan Task Linkage entry references exactly one reusable Task Template and defines how that task is used within the Care Plan journey. Task execution, runtime task creation, reminders, completion tracking, automatic completion from related runtime objects, and patient/staff display are handled by downstream runtime services.









Constraints

A Care Plan may link one or more Published Task Template Versions through separate Care Plan Task Linkage entries. 

Each Care Plan Task Linkage entry must reference exactly one Published Task Template Version. 

Linked Task Templates must be compatible with the Care Plan profile. 

Care Plan Task Linkage is the supported template-level mechanism for assigning reusable Task Templates to a care program in the current model. 

TaskWorkflowStage is defined at the Care Plan Task Linkage level because the same reusable Task Template may be used at different journey stages across different Care Plans. 

TaskGenerationTrigger is defined at the Care Plan Task Linkage level because the same reusable Task Template may be generated at different points in different Care Plans. 

RequiredForStageCompletion = True does not complete or validate the workflow stage inside Template Service. It only signals that downstream runtime services may use the runtime task completion state as a stage-completion dependency. 

DisplayAsChecklistItem = True does not define the UI layout. It only indicates that the task is eligible to appear in a downstream onboarding, review, or closure checklist view. 

Task Template continues to define reusable task identity, assignment type, reminder eligibility, mobile/action classification, and action destination where applicable. 

Runtime task creation, state management, reminder execution, automatic completion, checklist rendering, Action Center surfacing, and stage-completion validation are handled by downstream runtime services.

Section: Monitoring Template Linkage (Optional)



This section defines Monitoring Template linkage at Care Plan level. A Care Plan may link to one or more published Monitoring Template Versions.



Monitoring Template defines what data is collected, how it is collected, expected frequency, supported data sources (device, manual, integration), and associated threshold and alert evaluation behavior.



Care Plan references Monitoring Template(s) and does not define monitoring rules inline.









Constraints

 



Monitoring Template replaces earlier RPM-based design and provides a unified, reusable abstraction for all types of patient data collection across geographies and programs.



Device is treated as one of the supported data sources within Monitoring Template and is not modeled as a separate Care Plan section.



Section: Base Assessment Layer (Optional)

The Baseline / Assessment section defines the clinical, functional, demographic, behavioral, or program-specific intake fields used by the Care Plan. These fields are used to capture structured information required during onboarding, activation, or baseline review.



This section captures current-state or baseline information only. It does not define goals, monitoring frequency, thresholds, alerts, tasks, or workflow behavior.



Each parameter in Base Assessment must define:







Constraints

Numeric fields must define Min Value, Max Value, and Decimal Allowed where applicable. 

Data Source Type must come from the filtered Metadata Registry. 

Protected schema elements, including Data Type, remain platform-controlled unless explicitly supported by downstream control rules.

Baseline / Assessment parameters must not directly trigger alerts, tasks, monitoring requirements, or goal progress unless explicitly referenced by another template or runtime service.



Downstream Control Application

For this section:

each parameter definition is treated as a Field under the common control mechanism in 3.1 

additional custom parameters, where permitted, are treated as Entries 

selected values for metadata-backed enum fields are treated as Values



Example Baseline/ Assessment Parameters include

Clinical:

Vitals (Multi-select) 

Diagnostic Test - Multi select (O) 

Pain Score (O) 

Mobility Level (O) 

Functional:

Family Support (O) 

Work Stress Level (O) 

Caregiver Availability (O) 

Medication Adherence Risk (O) 

Psycho-social (O) 

Financial Limitations (O) 

Dietary Limitations (O) 

Environment (O) 





Section: Goal Template Linkage

This section defines Goal Template linkage at Care Plan level. A Care Plan may link to one or more published Goal Template Versions when GoalEnabled = True.

Goal Template owns the goal definition, Goal Type, Measurement Type, and Goal Measurement Entries with target structure for measurable goals. Care Plan only references the Goal Template and does not redefine goal details inline.







Constraints

 

Goal Template linkage is required only when GoalEnabled = True.

Only one Goal Template Version may be linked per Care Plan version.

Linked Goal Template must be Published.

Linked Goal Template must be compatible with the Care Plan profile: Category, Condition, Country, Language, and Specialty where applicable.

Care Plan does not define goal details inline.

Goal progress calculation and patient-level goal status are handled by downstream runtime services.

 

Section: OKR Linkage (Optional)

 The Care Plan must link to one published OKR Template Version.

This section defines optional OKR Template linkage at Care Plan level. OKR linkage is required only when OKREnabled = True.

Care Plan may link to one or more published OKR Template Versions for advanced care coordination, analytics, or structured program tracking.



Care Plan must define:

Linked OKR Template Version ID (Mandatory) 



Constraints:

Only one OKR Template may be linked per Care Plan version. 

Care Plan inherits OKR structure strictly. Structural elements defined in OKR Template cannot be modified at Care Plan level.

Task linkage remains governed by the linked OKR Template and is not defined separately at Care Plan level. 

Symptom Template linkage, where supported for KR, remains governed by the linked OKR Template and related template sections.

 

Section: Follow-up and Review 



This section defines the follow-up and review cadence for the Care Plan. It determines how frequently patient progress is reviewed and by whom. Follow-up and review define expected care team or provider engagement intervals and are independent of monitoring, task execution, or alert handling.





Follow-up and Review cadence does not define task creation, alerts, or monitoring behavior. Task creation and execution related to review cadence are handled by Task Templates and downstream runtime services.





Constraints:	

Care Plan cannot publish without the Follow-up and Review section. 

ReviewCadence defines the suggested review rhythm at template level and must be visible when the care plan is used at patient level. 

Included patient follow-up / visit count is driven by package consultancies. 

Downstream runtime services may allow additional follow-ups beyond package consultancies where operationally supported and explicitly overridden. 

Actual patient-level follow-up scheduling, completion, notes, and outcomes are handled by downstream runtime services.

Billing Program Reference (Optional)

This section defines billing program applicability for the Care Plan. The Care Plan may reference one or more billing program types and applicable diagnosis codes, but does not execute billing rules. Billing eligibility calculation, CPT rule execution, evidence generation, time tracking, and billing export are owned by the Billing Service.

Notes

 

This section provides billing context only.

Billing Service owns CPT mapping, eligibility rules, payer-specific rules, evidence validation, and export.

ICDCode may be used by Billing Service during patient-level billing setup.

Country-specific billing behavior must be handled by Billing Service.

GOAL MASTER TEMPLATE – DETAILED REQUIREMENTS



A Goal Template defines reusable patient-care goals that may be linked to a Care Plan Template.

A Goal defines:

what the care program wants to achieve for the patient 

the business classification of that goal through GoalType 

how the goal is measured, where applicable, through MeasurementType 

one or more Goal Measurement Entries for measurable goals 

the target structure that will later be used to create patient-level Goal Instances at runtime 

Goal Template does not define:

patient-specific baseline values 

current patient values 

monitoring frequency or allowed data sources 

threshold or alert behavior 

task execution or review workflow 

Those behaviors are handled by the respective runtime or supporting template/service models.









Goal Measurement Entry Fields

Goal Measurement Entries define the measurable tracked entities and target structure for a Goal.

Goal Measurement Entries are required when:

MeasurementType = Metric 

MeasurementType = Symptom 

MeasurementType = Engagement 

Goal Measurement Entries are not required when:

MeasurementType = Manual 

A single Goal may contain one or more Goal Measurement Entries.



 Goal Template Rules

Goal Template owns the reusable goal definition and goal measurement structure. 

GoalType and MeasurementType are separate concepts: 

GoalType defines what kind of goal it is 

MeasurementType defines how the goal is tracked 

If MeasurementType = Manual, Goal Measurement Entries are not required. 

If MeasurementType = Metric, Symptom, or Engagement, the Goal must define one or more Goal Measurement Entries. 

All Goal Measurement Entries under a Goal must be compatible with the parent MeasurementType: 

Metric goal → only AppliesToType = Metric 

Symptom goal → only AppliesToType = SymptomQuestion 

Engagement goal → only AppliesToType = EngagementEvent 

A single Goal may include multiple related measurement entries. 

Example: Control Blood Pressure may include: 

Metric + BP_SYSTOLIC 

Metric + BP_DIASTOLIC 

AppliesToType + LinkedEntityCode is stored at the Goal Measurement Entry level, not at the Goal definition level. 

Target configuration is stored per Goal Measurement Entry because each tracked entity may have a different target. 

Patient-specific baseline values, current values, status, progress summary, review notes, and history are handled by Goal Runtime Service. 

Goal Template does not define monitoring cadence, collection source, thresholds, alerts, tasks, or runtime review workflow. 

 

Example

Goal Definition

Goal Measurement Entries



Monitoring Master Template - Detailed Requirements



A Monitoring Template defines reusable monitoring configuration for a care program. It defines what patient data should be collected, how it may be collected, expected frequency, and supported sources.



Monitoring may include metric monitoring, symptom/questionnaire monitoring, device-supported monitoring, manual entry, integration-based data, or care-team-entered data.



Monitoring Template replaces RPM-specific configuration with a broader reusable monitoring model. Device is treated as one possible monitoring source, not as the monitoring model itself.





Monitoring Structure

 

Monitoring Template may contain one or more Monitoring definitions.

Each Monitoring definition is treated as an Entry within the Monitoring Template.







Key Rules

 

Monitoring Template owns monitoring configuration only. 

Monitoring Template identifies monitored entities using AppliesToType + LinkedEntityCode. 

Monitoring Template may reference a Symptom Template where the monitoring configuration requires questionnaire/form context. 

DataSources defines which source types are enabled for the monitored item and should drive downstream input/device enablement behavior where applicable. 

AllowedDevices defines which device types may be recommended or enabled when device-based monitoring is supported. 

Monitoring Template does not define threshold ranges, alert policy for threshold breaches, runtime task creation, or billing calculation. 

Where ThresholdApplicable = True, threshold runtime setup is initiated using the monitored entity context; ongoing threshold evaluation is owned by Threshold Runtime Service. 

Monitoring gap detection and gap-alert configuration remain part of Monitoring Template. 

Monitoring frequency may support downstream patient check-ins and reminders. 

Device is one supported monitoring source, not a required monitoring model

OKR MASTER TEMPLATE – DETAILED REQUIREMENTS

OKR Structure

An OKR Template defines an optional structured goal framework used by Care Plan templates where advanced outcome tracking, care team execution structure, or analytics are required. OKR Template is not required for all Care Plans. A Care Plan links to an OKR Template only when OKREnabled = True.

An OKR Template must define the following entities:

Objective 

Key Result (KR) 

Metric Linkage 

Symptom Linkage

Progress Evaluation 

Task Linkage

Objective Definition Fields



Relationship Rules

Each KR must belong to exactly one Objective. 

An Objective must contain at least MinKRRequired KRs. 

MaxKRAllowed defines the maximum number of KRs that may be linked to the Objective. 

Duration, Progress, and Status Rules

Objective does not store absolute start date or end date at template level. 

Objectives cannot be marked complete unless all linked KRs are complete, unless downstream override is explicitly supported. 

Downstream Behavior

Objective is treated as an Entry within the OKR Template for downstream control purposes. 

Addition, removal, and update of Objectives at downstream levels are governed by the common control mechanism defined in 3.1.

KR Definition Fields





KR Relationship Rules

Refer to Section 3.1.5

A KR may track a Metric or a SymptomQuestion using AppliesToType + LinkedEntityCode. 

Where AppliesToType = Metric, LinkedEntityCode must reference a valid MetricCode. 

Where AppliesToType = SymptomQuestion, LinkedEntityCode must reference a valid QuestionCode. 

Where a KR tracks a SymptomQuestion, LinkedSymptomTemplateVersionID must reference a compatible published Symptom Template containing that QuestionCode. 

A KR may still link a Symptom Template as supporting input even where progress remains manually updated. 

Not all questions in a linked Symptom Template are required to map to a KR.Each KR must belong to exactly one Objective. 

A KR cannot exist without an Objective. 

A KR may link to one Symptom Template where applicable. 

The whole Symptom Template is attached to the KR. 

Linked Symptom Template must be compatible with the linked Care Plan profile.

 

Quantitative KR Fields

 A KR may be either Quantitative or Qualitative. Type-specific fields and behavior must be defined as follows.

Quantitative KR Fields

If KR Type = Quantitative, the KR must define:









Quantitative KR Rules



One KR may link to only one MetricCode. 

One MetricCode may be linked to multiple KR. 

Symptom-Tracked KR Fields

Where a KR tracks a symptom question with a comparable numeric or scale-based value, the KR may define baseline and target values against the linked QuestionCode.



Constraints

BaselineValue and TargetValue may be defined only where the linked Question Code supports comparable numeric or scale-based progression. 

LinkedEntityCode must reference a QuestionCode contained within the linked Symptom Template. 

Symptom-tracked KR may use symptom responses as supporting input for manual progress updates. 



Qualitative KR Rules

If KR Type = Qualitative:





Qualitative KR Rules



Qualitative KR does not use metric linkage fields by default.

ManualProgressUpdateAllowed must be True unless explicitly restricted by platform rules. 

Qualitative KR progress is updated manually or through explicitly supported downstream workflow behavior. 

Qualitative KR may use a linked Symptom Template as a structured data capture mechanism where applicable



Progress Evaluation Model

The Progress Evaluation Model defines how KR progress and KR status are determined.

It applies to both Quantitative KR and Qualitative KR, based on the KR type-specific rules defined in 5.4.





Progress Evaluation Rules

ProgressValue is manually updated or updated through explicitly supported downstream workflow behavior. 

Quantitative KR may still define MetricCode, BaselineValue, and TargetValue, but automated progress calculation is out of scope for Phase 1.   

Qualitative KR does not use metric-linked evaluation. 

Manual progress update is required unless explicitly restricted by platform rules. 

Where a KR is linked to a Symptom Template, symptom responses may be used as supporting input for manual KR progress updates. 



KR to Task Linking

Rules

Each KR must link to at least MinTaskRequired Task Template(s). 

One KR may link to multiple Task Templates. 

One Task Template may be linked to multiple KRs. 

Linked Task Template(s) must be compatible with the template profile and published status. 

Task schedule must remain within KR duration.



Downstream Control Application for OKR Template

For OKR Template:

Objective is treated as an Entry within the OKR Template. 

KR is treated as an Entry within an Objective. 

Default downstream behavior for OKR Template:



Additional Rules

Org may add, remove, and update Objectives within the allowed control limits. 

Org may add, remove, and update KRs within the allowed control limits. 

Objective and KR additions must remain compatible with the linked Care Plan profile and all template constraints. 

Protected schema elements remain platform-controlled unless explicitly stated otherwise.



TASK MASTER TEMPLATE – DETAILED REQUIREMENTS



A Task Template represents one reusable task/action definition that may be selected by a Care Plan through Care Plan Task Linkage.

Task Template defines the reusable task structure needed for downstream runtime creation, reminder behavior, patient/staff visibility, mobile task-card classification, and destination routing.

Task Template does not define the Care Plan stage or generation trigger; those are defined in Care Plan Task Linkage. Runtime services handle patient-specific task creation, status changes, reminder scheduling, automatic completion, due-state movement, and display in mobile or portal workflows.



Task Definition Fields



































Task Template defines one reusable task/action definition. 

In the current model, reusable Task Templates are linked from Care Plan Task Linkage. 

Task Template does not define Care Plan journey stage or generation trigger. 

TaskType = CHECK_IN is not authored as a reusable Task Template in the current model; monitoring-driven check-ins are created by downstream runtime services from Monitoring configuration. 

TaskType = ACTION supports task/action items such as document completion, upload, device setup, instruction review, and similar care-plan actions. 

TaskType = LEARNING supports assigned education items such as videos, articles, or care-plan educational content. 

ActionDestinationType defines the destination flow the downstream UI/runtime should invoke when the task is opened. 

CompletionMethod defines whether runtime completion is manual, automatic from a linked runtime object, or both. 

ReminderEnabled and ReminderChannels define whether the task may have configured reminder behavior; actual reminder scheduling, delivery, suppression, and audit are runtime-owned. 

DisplayToPatient = False means the task may still exist for staff workflow but must not surface in patient-facing mobile task views. 

Task Template does not own runtime status, due-state movement, completion events, or Action Center placement.









SYMPTOM MASTER TEMPLATE – DETAILED REQUIREMENTS

 

A Symptom Template defines a reusable structured question set used to capture symptom, survey, and patient-reported inputs within a care program.

Symptom Templates may be used for:

symptom data collection 

survey-style or assessment-style questionnaires (in future)

qualitative or quantitative patient-reported inputs 

downstream KR input where a symptom question is explicitly linked to a KR 

threshold evaluation for supported questions 

patient reminder linkage for supported questions 



A Symptom Template may be linked through:

Monitoring Template, where symptom/questionnaire responses are collected on a defined cadence

Goal Template, where a symptom question is used to measure goal progress

OKR/KR, where OKR is enabled

Threshold Template, where symptom responses support threshold evaluation

Question Definition Fields

Each Symptom Template question must define:







Symptom Template Reminder Settings



Rules:

A Symptom Template may be linked directly at Care Plan level without being tied to any KR. 

A Symptom Template may also be used as supporting input for one or more KRs. 

Where a KR tracks a specific symptom question, the KR must reference the relevant QuestionCode through LinkedEntityCode. 

Not all questions in a Symptom Template are required to map to a Goal, KR, or Threshold. 

QuestionCode remains the canonical linkage key for symptom-based thresholding and KR tracking.

Symptom Template Rules

A Symptom Template may be linked to Monitoring Template, Goal Template, Care Plan, or OKR/KR where applicable.

A Symptom Template is linked to a KR as a whole template, not at individual question-to-KR level. 

Threshold linkage, where supported, is resolved using QuestionCode through AppliesToType + LinkedEntityCode.

Symptom Template does not store direct Threshold Template references. 

Reminder configuration is defined at question level when ReminderEnabled = True. 

Symptom Template provides structured input collection only; downstream services determine how responses are used for monitoring, goal progress, alerting, or workflow.



Downstream Control Defaults for Symptom Template

For Symptom Template:

each question is treated as an Entry within the Symptom Template 

selected values for metadata-backed question options are treated as Values 

Default downstream behavior for Symptom Template questions:





THRESHOLD & ALERT MASTER TEMPLATE – DETAILED REQUIREMENTS 

 

Threshold Purpose 

Threshold Template defines breach evaluation rules for supported linked entities.

Threshold Template may be used for:

metric-based threshold evaluation 

symptom-question-based threshold evaluation 

optional downstream Alert Policy linkage 

Threshold Template defines the threshold rule structure that may later be used by Threshold Runtime for patient-level evaluation.

Threshold Template does not define:

alert workflow 

SLA 

notification delivery 

dedup behavior

monitoring frequency

data source

whether a monitored item has thresholding enabled   
Where a Monitoring Definition has ThresholdApplicable = True, the applicable Threshold Template is resolved using AppliesToType + LinkedEntityCode and compatibility rules, and is used by downstream runtime services to establish patient-level Threshold Runtime setup.

Threshold Definition Fields





Examples This Supports









Threshold Template may be resolved by Monitoring Template or downstream runtime services using AppliesToType + LinkedEntityCode.

Threshold Template must support both single-observation threshold evaluation and change-over-period threshold evaluation. EvaluationType, EvaluationWindow, and ChangeDirection determine how the configured comparison boundary is interpreted at runtime.



Linked Entity Rules

LinkedEntityCode is the referenceable code for the entity being evaluated by the Threshold Template.

Rules

One Threshold band must link to exactly one LinkedEntityCode. 

One LinkedEntityCode may have multiple threshold bands. 

Threshold ranges for the same LinkedEntityCode must not overlap.

Alert Policy Linkage

Where alerting is required:

AlertRequired = True indicates that the threshold must link to an Alert Policy Template. 

LinkedAlertPolicyTemplateVersionID must reference a Published Alert Policy Template Version. 

Threshold Template does not define alert workflow behavior. 

Alert workflow remains external and is governed through Alert Policy Template and Alert Management Service. 

Alerts Template:



ALERT POLICY SCOPE DEFINITION

Alert Policy Template defines how generated alerts are classified, assigned, governed, and managed operationally. Alerts may originate from threshold breaches, symptom risk events, monitoring gaps, onboarding events, device issues, billing-risk events, or other supported runtime sources.





AppliesToType must align with the linked Threshold type. 

If LinkedEntityCode is populated, it must match the linked Threshold entity. 

If LinkedEntityCode is blank, the Alert Policy applies generically to the specified AppliesToType. 

CategoryCode is used for operational grouping, queueing, filtering, and reporting.

ALERT CLASSIFICATION SETTINGS



This section defines how alerts generated under the policy are classified for operational use, including priority and dedup behavior. Assignment, lifecycle, SLA, and notification behavior are defined in later sections.

 



ASSIGNMENT CONFIGURATION

This section defines the default assignment role for alerts generated under the policy.
Alerts may remain in Unassigned state until a user assigns them. Once assigned, an alert must have a single owner.



 Constraints

Alerts may be created in Unassigned state. 

Once assigned, an alert must have a single owner. 

Assignment must resolve to an org-supported role where applicable. 

Reassignment moves ownership from one user to another. 

Escalation is handled through reassignment and does not create a new ownership model.

LIFECYCLE RULES (State Governance)

This section defines the allowed alert lifecycle states. These states are fixed and are not configurable at template level.





Assigned means the alert has an owner. 

In Progress means active handling has started. 

Waiting means pending patient or external follow-up. 

Resolved and Dismissed are terminal states. 

This state model is fixed and cannot be changed at org level. 



 

SLA CONFIGURATION BINDING

This section defines the SLA profile applied to alerts and how SLA is shown in the UI. SLA is defined at alert policy level and resolved per org through the linked SLA profile.

SLA must be defined for alerts through the linked SLA profile. 

SLA is applied per org based on the resolved SLA profile. 

SLA timing and breach thresholds are controlled by the linked SLA profile, not by the alert template. 

SLA status must be shown in the UI with clock/timer indicator. 

SLA breach must be visually distinguished in the UI, including color change for breached clock/timer display.



SLA PRIORITY PROFILE DEFINITION

This section defines the SLA Priority Profile referenced by SLAPriorityProfileID in Alert Policy.
The SLA Priority Profile stores the actual SLA times used for alert handling. The same profile may be reused across multiple alert policies where applicable.

SLA time must be defined per priority within the SLA Priority Profile. 

AssignSLA starts from alert creation and is satisfied when alert moves from Unassigned to Assigned. 

ResolveSLA starts when alert is assigned and stops when alert reaches Resolved or Dismissed. 

The Alert Policy Template must reference a valid active SLAPriorityProfileID. 

SLA breach must be shown in the UI using the alert clock/timer indicator, including visual color change on breach. 

SLA Priority Profiles are reusable reference configurations and must not be duplicated in each alert policy.

 LINKING & COMPATIBILITY RULES

Linking Matrix





Validation Rules:

When linking templates, the system must enforce the following validation rules:



Only Published template versions may be selected for linking. 

A Care Plan may link one or more compatible Published Task Template Versions through separate Care Plan Task Linkage entries. 

Each Care Plan Task Linkage entry must define: 

LinkedTaskTemplateVersionID 

TaskWorkflowStage 

TaskGenerationTrigger 

RequiredForStageCompletion 

DisplayAsChecklistItem 

TaskGenerationTrigger must be valid for the selected TaskWorkflowStage. 

Each Task Template linked to a Care Plan must be compatible with the Care Plan profile. 

TaskType = CHECK_IN must not be configured through reusable Task Templates in the current model; monitoring-driven check-ins are created by downstream runtime services. 

If ReminderEnabled = True, ReminderChannels must contain at least one configured channel. 

If CompletionMethod = AutomaticFromLinkedObject or ManualOrAutomatic, downstream runtime must resolve the corresponding linked runtime object during task instantiation or task execution as applicable. 

ActionDestinationType must be compatible with TaskSubtype. 

Example: TaskSubtype = Document → ActionDestinationType = DocumentFlow 

Example: TaskSubtype = EducationVideo → ActionDestinationType = EducationContentFlow

Where a Monitoring Definition has ThresholdApplicable = True, a valid Published Threshold Template must exist for the same AppliesToType + LinkedEntityCode combination and compatible template profile.

Threshold applicability is configured on the Monitoring Definition, but threshold range logic and downstream alert-policy linkage remain owned by the Threshold Template.

Care Plan Task Linkage metadata must be preserved as part of the Care Plan Template Version and must not be inferred only at runtime.	

A Goal with MeasurementType = Metric, Symptom, or Engagement must define one or more Goal Measurement Entries. 

A Goal with MeasurementType = Manual does not require Goal Measurement Entries. 

Each Goal Measurement Entry must define: 

AppliesToType 

LinkedEntityCode 

Goal Measurement Entries must be compatible with the parent Goal MeasurementType: 

Metric goal → Metric entries only 

Symptom goal → SymptomQuestion entries only 

Engagement goal → EngagementEvent entries only 

Target configuration must be stored at Goal Measurement Entry level for measurable goals.

  Linking Resolution Model



Linking in Template Service supports two resolution models:



Direct Links: explicitly selected during template design and stored as TemplateVersionID references 

Derived Links: resolved using metadata/entity compatibility rules and stored only where applicable in downstream runtime usage



Direct Links



Direct links are selected during template design and stored explicitly in the template version.

Examples:

Care Plan → OKR Template 

Care Plan → Task Template 

Care Plan → Symptom Template 

KR → Task Template 

KR → Symptom Template 

Care Plan → Goal Template

Care Plan → Monitoring Template

Threshold Template → Alert Policy Template

Derived Links



Derived links are not manually selected in the source template.

Instead, the system resolves the matching template using the applicable entity reference and compatibility rules.

Examples:

KR identifies tracked entity using AppliesToType + LinkedEntityCode 

Where a Monitoring Definition has ThresholdApplicable = True, the system resolves the compatible Published Threshold Template using: 

AppliesToType 

LinkedEntityCode 

template profile compatibility 

Published status 

The resolved Threshold Template is used by downstream runtime services to create patient-level Threshold Runtime setup where applicable. 

Monitoring Template → Threshold Template is a derived link and is not manually selected in the Monitoring Template.



Rules



A Monitoring Template does not manually select a Threshold Template. 

Threshold Template resolution occurs only where ThresholdApplicable = True on the Monitoring Definition. 

Derived threshold resolution must use the applicable monitored entity and compatibility rules. 

Care Plan does not manually select a Threshold Template where derived resolution is used. 

Alert Policy is not manually linked from Care Plan, Monitoring Template, or KR. 

Alert Policy linkage is defined only through the resolved Threshold Template.



Alert Binding Rule

Where alerting is required, the Threshold Template must reference a Published Alert Policy Template Version.

Alert Policy linkage is defined only through the Threshold Template.

Care Plan, OKR Template, and KR do not directly bind Alert Policy Template.

If alerting is not required for the threshold, Alert Policy linkage is not required.

 ORG TEMPLATE DERIVATION RULES

Every Org Template must: 

An Org Template is created by deriving from a specific Published Master Template Version.
After derivation, the Org Template maintains its own independent version history.

Requirements

Each Org Template must reference a valid MasterTemplateVersionID. 

The referenced MasterTemplateVersionID must point to a Published Master Template Version. 

The MasterTemplateVersionID reference must be stored permanently for lineage. 

The Org Template must maintain its own independent version history after derivation. 

Org Template derivation must use the inheritance model defined in this section.

Derivation Rules

Org Templates may modify derived content only within the control rules defined by the Master Template.
Any change outside those allowed controls is not permitted.

Org May:

Remove optional sections where allowed by Master control rules. 

Add entries only within defined extension points and allowed limits. 

Update configurable values only where Master control rules permit. 

Narrow selected metadata values where permitted. 

Change default values where permitted. 

Use newly available metadata values only where MetadataMode permits.

Org cannot:

Change Template Type. 

Change Category. 

Change Condition. 

Change Country binding. 

Change structural linking schema. 

Change inheritance behavior. 

Change DataType of protected parameters. 

Change platform-controlled severity taxonomy. 

Change platform-controlled dedup model unless explicitly supported.



Metadata Behavior

Behavior for metadata-backed fields after derivation is governed by the MetadataMode defined in the Master Template.

Constraints

Org must not use metadata values outside the allowed template profile. 

Metadata expansion does not override other template constraints. 

Metadata behavior must follow the Master-defined MetadataMode for that field or entity. 



Structural Protection Rules

Certain structural elements remain platform-controlled and are not changeable at Org level unless explicitly supported.

Protected elements include:

Linking schema 

Template profile identity 

Parameter DataType 

Section identity 

Platform-controlled taxonomies 

Constraints

Protected structural elements cannot be changed by Org Templates. 

Org changes must remain within Master-defined control and extension rules. 



Versioning Rules

Org Template versioning is independent after derivation, but version creation must still follow common versioning rules.

Constraints

Any Org change that requires a new version under common versioning rules must create a new Org Template version. 

Published Org Templates are immutable. 

Draft Org Templates may be edited in place until published. 



Deletion Rules

Templates in Saved or In Review state may be deleted, provided they are not already referenced by another template or used by downstream runtime processes where applicable. 

Published templates must never be deleted. 

Once published, a template may only be superseded through a new version and the prior published version becomes Inactive / Archived as per status rules.



Inheritance Rules

All Org Templates use:

InheritanceType = CopyOnCreate

Meaning

Org Template copies Master structure at derivation time. 

Changes to Master do not automatically update existing Org Templates. 

Org must manually adopt a newer Master version through a new derivation or versioning action. 



Metadata Registry: 

	Refer to Requirements_Metadata_Registry.docx

 

Naming Convention, Versioning and Codes:

Naming convention : TemplateID format (Aligns with Version ID refer to Section 3.3)

<TemplateTypeShort>-<DomainShort>-<Sequence>

Examples:

CP-HTN-001 

OKR-HTN-001 

TSK-BPREAD-001 

SYM-PAIN-001 

THR-BPSYS-001 

ALT-VITALS-001 

TemplateVersionID format

<TemplateID>-V<NN>

Examples:

CP-HTN-001-V01 

CP-HTN-001-V02 

SYM-PAIN-001-V03 

Version field

1 

2 

3 

SectionID

<TemplateVersionID>-SEC-<SectionShort>
or
<TemplateVersionID>-SEC-<NN>

Examples:

CP-HTN-001-V01-SEC-01 

CP-HTN-001-V01-SEC-MON 

CP-HTN-001-V01-SEC-OKR 

CP-HTN-001-V01-SEC-REV



Direct Field Control Overrides



This section applies only to non-metadata-backed fields where downstream behavior differs from the default control behavior.

If a direct-value field is not listed in this section, the default downstream behavior applies:

Update = No 

Remove = No







Rules

This section applies only to non-metadata-backed fields. 

Any direct field not listed here uses the default downstream behavior defined in 3.1. 

Where a field is listed here, the override defined in this section takes precedence over the default. 

Metadata-backed fields must not be listed here unless the field itself is direct-value and separate from metadata value selection.



















































































































































































































































































































