You are a Principal Staff Engineer and Distributed Systems Architect.

Review the entire event-platform and middleware libraries in this repository and perform a deep architectural analysis.

Your goal is to identify everything missing, inconsistent, risky, or incomplete for making ALL async transports behave consistently under a unified event-driven platform architecture.

The current system already supports:
- Middleware execution pipeline
- EventBridge consumers
- EventBridge publishing
- Generic middleware engine
- Retry strategies
- DLQ strategies
- Idempotency strategies
- Context propagation
- Tracing/logging/performance middleware
- BaseEvent abstraction
- createEventHandler()
- consumeEvent()
- Event schema validation
- Batch processing concepts

I want the platform to support ALL transports consistently:

1. EventBridge
2. SQS
3. SNS
4. DynamoDB Streams 

The review should focus on making all transports behave with the SAME developer experience and SAME reliability guarantees as EventBridge.

Review the following areas in detail:

========================================
ARCHITECTURE REVIEW
========================================

Analyze:
- Overall architecture quality
- Transport abstraction quality
- Separation of middleware vs event-platform responsibilities
- Extensibility
- Scalability
- Coupling
- Runtime consistency
- Failure isolation
- Batch handling consistency
- Developer experience
- Type safety
- Runtime safetyb

========================================
TRANSPORT STANDARDIZATION REVIEW
========================================

For EACH transport evaluate:

- Producer abstraction completeness
- Consumer abstraction completeness
- Batch handling
- Partial failure support
- Retry semantics
- DLQ support
- Correlation propagation
- Trace propagation
- Idempotency behavior
- Ordering guarantees
- FIFO handling
- Visibility timeout handling
- Poison message handling
- Schema validation
- Payload normalization
- Metadata normalization
- Observability support
- Metrics support
- Error classification
- Concurrency handling 
- Re-drive compatibility
- Transport-specific edge cases

========================================
MIDDLEWARE REVIEW
========================================

Review the middleware engine and identify:
- Execution order problems
- Error propagation issues
- AsyncLocalStorage risks
- Batch-awareness gaps
- Missing lifecycle hooks
- Missing transport hooks
- Missing observability hooks
- Memory leak risks
- Trace segmentation issues
- Middleware isolation problems
- Performance bottlenecks
- Missing middleware categories

Identify whether the middleware system is:
- event-aware
- transport-aware
- batch-aware
- stream-aware

========================================
SQS REVIEW
========================================

Specifically analyze whether SQS support is production-grade.

Check for:
- Partial batch failure response
- Visibility timeout extension
- ApproximateReceiveCount integration
- FIFO queue support
- Delay queue support
- Message attributes normalization
- SNS->SQS unwrapping
- Batch checkpointing
- DLQ integration
- Poison pill handling
- Duplicate prevention
- Large payload strategy
- S3 offloading support
- Long polling awareness
- Lambda batch window compatibility

Identify ALL missing components.

========================================
SNS REVIEW
========================================

Check:
- SNS raw delivery support
- SNS envelope normalization
- Fanout consistency
- Message attributes propagation
- FIFO topic support
- Cross-account publish support
- Mobile push compatibility
- Delivery retry consistency
- Subscription filter support

========================================
DYNAMODB STREAM REVIEW
========================================

Review support for:
- INSERT/MODIFY/REMOVE normalization
- OldImage/NewImage abstraction
- Sequence number handling
- Replay/idempotency handling
- Stream batch checkpointing
- Event ordering
- Shard concurrency
- Partial failure behavior
- Event source mapping compatibility

Identify what abstractions are missing to make DynamoDB Streams behave similarly to EventBridge.
 
========================================
UNIFIED EVENT MODEL REVIEW
========================================

Review the BaseEvent model.

Check whether ALL transports can consistently map into:
- eventId
- eventType
- eventVersion
- source
- timestamp
- payload
- meta
- retryCount
- traceId
- correlationId
- causationId
- tenantId
- partitionKey
- orderingKey

Identify what fields are missing.

========================================
DEVELOPER EXPERIENCE REVIEW
========================================

Review:
- createEventHandler()
- onEvent()
- adapters
- publishers
- middleware APIs

Check whether developers can build:
- EventBridge consumers
- SQS consumers
- SNS consumers
- DynamoDB stream consumers 

with the SAME developer experience.

Identify all inconsistencies.

========================================
OUTPUT FORMAT
========================================

Provide: Output as .md file inside  docs folder

1. Executive Summary
2. Current Strengths
3. Critical Gaps
4. Transport-by-Transport Gap Analysis
5. Middleware Gap Analysis
6. Reliability Risks
7. Missing Runtime Components
8. Missing Middleware
9. Missing Abstractions
10. Missing SDK APIs
11. Missing Type Definitions
12. Missing Observability
13. Missing AWS Best Practices
14. Recommended Folder Structure
15. Recommended Architecture Refactor
16. Recommended Unified Transport Model
17. Recommended Execution Pipeline
18. Recommended Batch Processing Model
19. Recommended Retry/DLQ Architecture
20. Recommended Future-Proofing
21. Priority-based Action Plan

For EVERY identified issue include:
- Why it matters
- Impact
- Risk level
- Suggested implementation
- Suggested file/module structure
- Example API design

Be brutally honest and production-grade in the review.
Think like a platform architect designing an enterprise-grade event framework similar to:
- AWS EventBridge ecosystem
- Kafka Streams framework
- NestJS event infrastructure
- Temporal reliability model
- Netflix event platform
- Uber Cadence-style reliability concepts

Focus heavily on:
- reliability
- consistency
- extensibility
- developer experience
- transport abstraction
- operational excellence
- distributed systems correctness