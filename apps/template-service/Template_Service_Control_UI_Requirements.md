UI Requirements – Org Template Enablement and Control Management

Purpose

This UI is used by Super Admin / Platform Admin to:

enable published master templates for an org

define the org’s allowed scope within those templates

define what the org may later manage within that allowed scope

<Later Orgs can use same or a version of this to manage>

manage version adoption when newer master versions are published

This UI does not manage runtime patient workflows.

Org List Screen

Purpose

Provide a list of orgs available for template enablement and management.

Required UI elements

Search by org name

Filter by org status

Filter by country or module if supported

Table columns:

Org Name

Org Status

Country

Enabled Template Count

Last Updated

Action:

Manage Templates

Notes

This is the entry point for org template management.

No template editing should happen on this screen.

Org Template Enablement Landing Screen

Purpose

After selecting an org, show all enabled master templates and allow new enablement.

Required UI sections

A. Org Summary

Show:

Org Name

Country

Enabled modules/features (This is required as this helps what orgs get) - This could be same matching criteria -> Category, Condition, Country, Language

Last updated timestamp

B. Enabled Templates Table

Columns:

Template Name

Template Type

Master Template ID

Master Version

Org Status

Upgrade Available (Difference of Org and Mater)

Actions

Actions:

Manage (Point 4 below)

Disable

Enable New Template (Point 3 below)

Enable New Master Template Flow

Purpose

Allow super admin to enable/create (Copy) a published master template for an org.

Required fields. to filter/select

Template Type

Master Template Name

Master Version

Condition/Category/Country (May be modules to ensure that same is available)

Notes, optional to add for super admin.

Required validations

only published master templates can be selected

template must be compatible with org/module setup where relevant

same master template version should not be enabled twice for the same org unless explicitly supported

Notes

This flow should not include section-level or field-level control editing.

After enablement, user lands in template management view.

Org Template Management Screen

This screen should open when the user clicks Manage for one enabled template.

Recommended layout

Use 4 tabs:

Overview

Enabled Scope

Org Manageability

Versioning

Overview Tab

Purpose

Provide context before detailed configuration. (View Only)

Show

Master Template Name

Template Type

Category/Condition/Country

Master Template ID

Master Version

Org Template ID

Org Template Version

Published / Draft status

Whether newer master version exists

Whether org has local changes

Notes

This tab is read-only except actions like:

View differences

Create upgrade draft

Enabled Scope Tab

Purpose

Define what is enabled for this org inside the derived template.

Recommended display

Use a tree or expandable hierarchy:

Section

Entry / Entity

Field

Metadata-backed value set

Required columns

Name

Type

Enabled

Mandatory

Org Editable

Default / Notes

Controls (Org Manageability)

Behavior rules

Mandatory items must be shown but locked as enabled

Optional items may be enabled/disabled

Metadata-backend fields should allow value subset selection only where master rules permit

For metadata-backed fields:

show all master-allowed values

allow org to enable a subset only where permitted

show selected default value separately

enforce Metadata mode and master control rules

Fixed values remain locked

Expandable values may allow additional future metadata where supported

Org cannot enable values outside master-allowed set unless explicitly supported

Default values should be shown where relevant

Hidden/system fields should not clutter the view unless advanced mode is enabled

Notes

This tab defines what the org gets

It does not yet define all detailed downstream control attributes (Poin5 below)

Metadata-backed Field Value Allocation:

For metadata-backed fields, the Enabled Scope Tab must support org-level value allocation from the master-allowed value set.

The main hierarchy view must show only summary information for the metadata-backed field, including:

whether the field is enabled

current default value, where applicable

summary of allocated values for the org

Detailed value allocation must be managed through a secondary interaction such as a drawer, side panel, or modal opened from the selected metadata-backed field row.

The value allocation interaction must support:

viewing the master-allowed value set

enabling or disabling the org-visible subset where permitted

selecting the default value from the enabled subset

viewing and enforcing MetadataMode

enforcing MinSelections and MaxSelections where applicable

Rules

Only values allowed by the master template may be allocated to the org.

The org-visible value set may be the full master-allowed set or a restricted subset.

The default value must belong to the allocated org-visible value set.

If MetadataMode = Fixed, the org-visible value set must remain fixed.

If MetadataMode = Expandable, newly available master-allowed values may be considered for org allocation where supported.

Org users must not see or select metadata values that are not allocated to that org through the enabled template scope.

Notes

Metadata value allocation is part of Enabled Scope, because it defines what values the org receives.

This is different from Org Manageability, which defines whether the org may later modify the allocated value set, change the default, or use expandable metadata.

Metadata value allocation changes at super-admin level must not automatically change existing org draft or published templates unless explicitly saved and published through the org template versioning flow.

Example to add below it

Example – DurationType

In the main Enabled Scope hierarchy, the row may show:

When Manage Values is opened, the UI should show:

Metadata Type: DurationType

MetadataMode: Fixed

MinSelections: 1

MaxSelections: 1

Org Enabled Values

30D

90D

6M

12M

Custom

Default Value

Default: 90D

Example – Condition

In the main Enabled Scope hierarchy, the row may show:

When Manage Values is opened, the UI should show:

Org Enabled Values

Hypertension

Diabetes

PostOp

Wellness

Obesity

Asthma

Default Value

Default: Hypertension

Org Manageability Tab

Purpose

Define what the org can later manage inside the enabled scope.

Recommended display

Use the same tree hierarchy as Enabled Scope, but focus on manageability controls.

For each of the items in Section 4.2 (Enabled scope) we have to provide options.

Show

Item Name

Type

Org Can Edit

Org Can Remove, where applicable (Not mandatory or Minimum condition)

Org Can Add, where applicable

Default Editable

Metadata Values Expandable, where applicable

Advanced Controls gear icon

This is how this can behave for each area

What should go in Advanced Control

Use the gear only for details, not as the main place for everything.

For Section / Entry

inherited master control

effective org control

notes / constraints

For Direct Field

whether edit is allowed

whether default is editable

field-specific notes

For Metadata-backed Field

allowed value set preview

selected value set preview

default value

metadata mode

min/max selections

Mandatory items

Be strict:

Mandatory Section / Entry / Field

always visible

always enabled

cannot be disabled

remove toggle hidden or locked

Do not show them as unchecked.

Do not let user disable them.

Notes

This tab defines what the org admin can manage later

It should not show actual org user-role mapping in detail

We don't need to show any User at this level as by default its enabled for Org Admin. That will be enabled at Org level where we need to show what role within the org can do or cannot do.(See section 5 below for those requirements)

Handling

Admin role is non editable at org level? (Add ticket)

For metadata-backed fields, Org Manageability defines whether the org may later change the allocated value set, change the default value, or use metadata expansion where supported.

Versioning Tab

Purpose

Show master-to-org version relationship and upgrade path.

Required table

Columns:

Template Name

Current Org Version

Derived From Master Version

Latest Master Version

Upgrade Available

Local Changes Present

Actions

Actions

View Differences

Create Upgrade Draft

Keep Current Version

Publish Org Version

Rules

Master changes do not auto-update existing org templates

New master versions must be adopted explicitly

Upgrade should create a new org draft version

Existing published org versions remain valid until replaced

Changes to metadata value allocation, default value, or metadata-backed field enablement at org-template level must be treated as org template changes and follow the same draft / publish versioning flow as other org template edits.

New master metadata values must not automatically appear in an org template unless the effective metadata mode and org allocation flow permit them and the resulting org template change is saved through the appropriate versioning flow.

ORG TEMPLATE MANAGEMENT

Purpose

This section defines how an org manages templates that have already been enabled for that org by Super Admin. Org-level management is limited to the enabled scope and manageability controls defined during org template enablement.

Org Template List Screen

Org Template List Screen follows the same general UI pattern as Section 1 Org List Screen and Section 2 Org Template Enablement Landing Screen, but is limited to templates already enabled for the current org.

Org-level constraints / differences

Org users must see only templates enabled for their org.

Org users must not enable or disable master templates for the org.

Org users must not access templates not enabled for their org.

Actions must be limited to org-level template management, such as:

Manage Template

View Differences

Create Draft, where permitted

Org Template Management Screen

Org Template Management Screen follows the same UI structure and hierarchy defined in Section 4 Org Template Management Screen, including:

Overview Tab

Template Configuration / same hierarchy as Enabled Scope and Org Manageability combined for org-visible editing

Versioning Tab

At org level, the UI must enforce the org-enabled scope, org manageability rules, and org role permissions defined for that template.

Overview Tab

Overview Tab follows the same UI pattern as Section 4.1 Overview Tab.

Org-level constraints / differences

Org users must see only org template information relevant to their org.

Org users must not edit master template metadata from this tab.

Actions are limited to those permitted for the org role, such as:

View Differences

Create Draft, where permitted

Create Upgrade Draft, where permitted

Template Configuration Tab

Template Configuration Tab follows the same hierarchy and general UI pattern defined in Section 4.2 Enabled Scope Tab and Section 4.3 Org Manageability Tab.

At org level, the screen must expose only those items and controls that are:

enabled for the org

manageable by the org

permitted for the current org role

Org-level constraints / differences

Org users must not widen the enabled scope defined by Super Admin.

Org users must not access controls not granted through Org Manageability.

Mandatory items must remain visible, enabled, and locked where removal is not allowed.

Metadata-backed fields must allow selection only from the org-enabled value set.

Default values must remain within the enabled value set.

Hidden or system-managed items should remain hidden unless explicitly exposed in advanced mode.

Master-only controls and super-admin-only controls must not be editable at org level.

Versioning Tab

Versioning Tab follows the same general UI pattern as Section 4.4 Versioning Tab.

Org-level constraints / differences

Org users may manage only org draft and published versions for their own org.

Org users must not modify master versions directly.

Master changes do not auto-update org templates.

Upgrade must create a new org draft version.

Publish actions must be limited by org role permissions.

Existing published org versions remain valid until replaced.

Org Role Capability Matrix

Purpose

Define what each org role may do when managing org templates.

Required matrix

Rules

By default, Org Admin is enabled for org template management.

Org roles may manage templates only within the enabled scope and org manageability controls.

Detailed org user-role administration is governed by org-level requirements and is not defined in Template Service.

Org roles must not gain authority beyond what Super Admin enabled for that org.

Notes

This section defines capability at org level, not user assignment.

Actual user-to-role mapping is handled in Org requirements / Org administration.

Org Upgrade Behavior

Rules

Where a newer master version exists, the org may create an upgrade draft from that newer master version.

Upgrade does not overwrite the current published org version automatically.

Upgrade flow must preserve lineage to both:

current org version

adopted master version

Where local org changes exist, upgrade flow must allow review of differences before publish.

Org may keep the current published version without adopting the newer master version.

Appendix:

Common Metadata Fields

This is not a section and neither entity. I would just call it Common Header

Entity = not really present in 3.2; these are mostly header-level fields.

Metadata-backed = Template Type, Category, Condition, Country, Language, Specialty, Status, ShareScope.

Direct = Template Name.

System/header = Template ID, Version, OwnerOrgID, MasterTemplateVersionID, Created/Modified fields.

Template Service hierarchy by template type

Care Plan Template

Sections

RPM & Device

Base Assessment

OKR & Tasks

Follow-up & Review

Care Plan-level Symptom Linkage, if you added this

Care Plan-level Task Linkage, if you added this

Entities under Care Plan

Device configuration row

Base Assessment parameter

Linked OKR Template reference

Linked Task Template reference

Linked Symptom Template reference

Follow-up rule / review rule row, if repeatable

Fields under Care Plan

Examples from your requirements set:

Template Name

Category

Condition

Country

Language

Specialty

ShareScope

DurationType

ReviewCadence

AllowedPrimaryDevices

DefaultPrimaryDevice

Parameter Name

DataSourceType

Min Value

Max Value

Decimal Allowed

LinkedOrgCarePlanVersionID, where package uses it later

Metadata-backed fields under Care Plan

Category

Condition

Country

Language

Specialty

ShareScope

DurationType

ReviewCadence

AllowedPrimaryDevices

DataSourceType

OKR Template

Sections

Objectives

KR Definition

KR Linkage

Entities

Objective

KR

Linked Task Template

Linked Symptom Template

Fields

Objective Text

Objective Category

MinKRRequired

MaxKRAllowed

KR Text

KR Type

AppliesToType

LinkedEntityCode

KR Duration

ReviewFrequency

BaselineValue

TargetValue

ManualProgressUpdateAllowed

TargetOverrideAtOrg

TargetOverrideAtPatient

LinkedSymptomTemplateVersionID

Metadata-backed fields

ObjectiveCategory

KRType

AppliesToType

ReviewFrequency

MetricCode, through LinkedEntityCode where AppliesToType = Metric

QuestionCode, through LinkedEntityCode where AppliesToType = SymptomQuestion

Task Template

Sections

Task Definition

Schedule

Reminder

Entities

Usually none beyond the task itself, because you decided:

1 Task Template = 1 reusable task definition

Fields

TaskName

Description

AssignedToType / OwnerRoleType

TaskCategory

ScheduleType

RecurrencePattern

StartRule

EndRule

ReminderEnabled

ReminderChannels

Metadata-backed fields

AssignedToType / OwnerRoleType

TaskCategory

ScheduleType

RecurrencePattern

StartRule

EndRule

ReminderChannel

Symptom Template

Sections

Symptom Questions

Symptom Template Reminder

Entities

Question

Fields

QuestionText

QuestionCode

QuestionType

MandatoryFlag

TrendEligible

ThresholdLinkAllowed

NumericMin

NumericMax

AllowedValues

DefaultValue

ReminderEnabled, if still used at template level

ReminderFrequency

ReminderChannels

Metadata-backed fields

QuestionCode

QuestionType

ReminderFrequency

ReminderChannel

Important naming rule

QuestionCode is the canonical linkage key

QuestionText is display wording

Threshold and KR should reference QuestionCode, not free text

Threshold Template

Sections

Threshold Definition

Alert Linkage

Entities

Usually one threshold rule record per template, unless you later support grouped threshold rules

Fields

AppliesToType

LinkedEntityCode

ComparisonOperator

SingleValue

MinValue

MaxValue

SeverityLevel

ConsecutiveBreachCount

AlertRequired

LinkedAlertPolicyTemplateVersionID

Metadata-backed fields

AppliesToType

LinkedEntityCode, resolved by type

ComparisonOperator

SeverityLevel

Priority, if retained

Alert Policy reference, though that is a linked template not a metadata field

Alert Policy Template

Sections

Alert Scope

Classification

Assignment

Lifecycle

SLA Binding

Entities

Usually none beyond the policy itself, unless you later model multiple policy blocks

Fields

AppliesToType

LinkedEntityCode, if you retained it

CategoryCode

DefaultPriority

DedupKeyStrategy

DefaultAssignmentRoleType

AlertState model reference

SLAPriorityProfileID

Metadata-backed fields

AppliesToType

CategoryCode

DefaultPriority

DedupKeyStrategy

DefaultAssignmentRoleType / OwnerRoleType

AlertState

SLAPriorityProfileID, if modeled as metadata or reusable config reference

----------------------------------------------------------------------------------------------------------------

Designer Read:

1. Canonical hierarchy for Template Service UI

Use only these 4 levels in UI and requirements.

Control meaning by level

That last row is important: it is the missing piece that was causing confusion.

Metadata Registry hierarchy

Use only these levels.