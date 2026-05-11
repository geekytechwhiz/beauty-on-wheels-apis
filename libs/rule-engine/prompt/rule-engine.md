You are a senior software architect with deep expertise in:

* NX Monorepo (TypeScript)
* AWS Serverless (Lambda, EventBridge, DynamoDB, S3)
* Rule Engines (JSON Rules Engine / DSL-based systems)
* Scalable Healthcare Platforms
* Event-driven microservices architecture

---

# 🧠 CONTEXT

We are building a **centralized Rule Engine system** inside an existing NX monorepo.

This system will:

* Drive behavior across multiple services:

  * Template Service
  * CarePlan
  * OKR
  * Future modules (Survey, Rewards, etc.)
* Replace hardcoded conditional logic
* Be fully dynamic and configurable

---

# 📂 EXISTING SYSTEM

* NX Monorepo with apps + libs
* Serverless services deployed via Serverless Framework
* Uses TypeScript
* Uses S3 for large JSON storage
* Uses DynamoDB for metadata
* Event-driven architecture (EventBridge)

---

# 📊 RULE SOURCE (VERY IMPORTANT)

There is an **Excel file already provided in the project** which contains:

* Multiple sheets
* Each sheet represents a **domain (Template, CarePlan, etc.)**
* Each row represents a **rule**
* Columns represent:

  * Conditions
  * Actions
  * Constraints
  * Metadata

---

# 🎯 OBJECTIVE

Build a **production-ready Rule Engine system** with:

## 1. NX Library

Create a reusable library:

libs/rule-engine/

Structure:

libs/rule-engine/
├── src/
│   ├── engine/
│   ├── parser/
│   ├── evaluator/
│   ├── types/
│   ├── registry/
│   ├── loader/
│   └── utils/
├── rules/
│   ├── master/
│   ├── careplan/
│   ├── template/
│   └── derived-from-excel/
└── index.ts

---

## 2. Excel → Rule DSL Conversion

You MUST:

1. Read the Excel file from the repo
2. Parse ALL sheets
3. Convert each row into a **structured JSON Rule DSL**

### Final Rule Format (MANDATORY)

Each rule MUST be transformed into:

{
"id": "RULE_<auto_generated>",
"name": "<derived_from_excel>",
"sourceSheet": "<sheet_name>",
"description": "<from_excel_if_available>",
"priority": number,
"enabled": true,
"conditions": {
"all" | "any": [
{
"fact": "<field>",
"operator": "equal | notEqual | greaterThan | lessThan | in | contains",
"value": "<value>"
}
]
},
"actions": [
{
"type": "SET | ENABLE | DISABLE | TRANSFORM | TRIGGER_EVENT",
"target": "<field_or_feature>",
"value": "<value>"
}
],
"metadata": {
"module": "template | careplan | okr | etc",
"version": "v1",
"createdFrom": "excel"
}
}

---

## 3. Rule Engine Core

Implement:

### RuleEngine class

Features:

* evaluate(context)
* supports:

  * AND / OR conditions
  * nested conditions
  * priority handling
  * enable/disable rules
* returns:

  * applied rules
  * resulting actions

---

## 4. Rule Registry

Create:

* RuleRegistryService

Responsibilities:

* Load rules from:

  * JSON (generated from Excel)
  * S3 (future-ready)
* Cache rules in memory
* Support:

  * getRulesByModule(module)
  * getRulesByTemplate(templateId)
  * versioning

---

## 5. Rule Loader

* Load rules at startup
* Validate schema
* Fail fast if invalid

---

## 6. Integration Layer

Expose:

* evaluateRules(context, module)

Example:

const result = ruleEngine.evaluate({
module: "careplan",
patientAge: 45,
condition: "diabetes"
});

---

## 7. Event-Driven Support

Add optional support:

* If action.type === "TRIGGER_EVENT"
  → publish to EventBridge

---

## 8. Type Safety

Create strong TypeScript types:

* Rule
* Condition
* Action
* EvaluationContext
* EvaluationResult

---

## 9. Validation

* Validate rules using JSON schema
* Throw errors for:

  * invalid operator
  * missing fields
  * malformed conditions

---

## 10. Testing

Add:

* Unit tests for:

  * rule parsing
  * rule evaluation
  * priority resolution

---

# ⚠️ CONSTRAINTS

* DO NOT break existing services
* DO NOT change existing API contracts
* MUST be backward compatible
* MUST be scalable to 10k+ rules
* MUST support multi-tenant (future-ready)

---

# 🧪 OUTPUT EXPECTATION

You MUST generate:

1. Full NX library code
2. Parsed rules from Excel → JSON DSL
3. Rule engine implementation
4. Example integration usage
5. Test cases
6. Folder structure
7. Explanation of how to extend

---

# 🔥 IMPORTANT

* Do NOT assume anything
* If Excel columns are unclear → infer logically and document mapping
* Ensure rules are HUMAN READABLE
* Ensure rules are MACHINE EXECUTABLE

---

# 🚀 FINAL GOAL

A **centralized, scalable, production-ready Rule Engine**
that drives:

* Templates
* CarePlans
* OKRs
* Future modules

with **ZERO hardcoded logic**

---

Now:

1. Analyze the repository
2. Locate the Excel file
3. Generate the full implementation
4. Convert Excel → Rule DSL
5. Build the complete system
