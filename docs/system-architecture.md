# System Architecture Diagram

```mermaid
graph TB
    CitizenApp["Citizen App<br/>(Web/Mobile)"]
    APIGateway["API Gateway"]
    AuthConsent["Auth & Consent Service"]
    ConsentStore["Consent Store"]
    EntitlementEngine["Entitlement Engine"]
    GovtAdapter["Govt Eligibility Adapter<br/>(Read-only)"]
    PolicyService["Employer / Bank<br/>Policy Service"]
    KnowledgeGraph["Insurance Knowledge Graph"]
    HospitalLayer["Hospital Integration Layer"]
    TPAInsurer["TPA / Insurer APIs"]
    HospitalPortal["Hospital Portal"]
    ClaimsService["Claims Assistance Service"]
    Notifications["Notifications<br/>(SMS / WhatsApp / Email)"]
    Analytics["Analytics & Reporting"]
    AuditLogs["Audit & Compliance Logs"]

    CitizenApp -->|HTTPS| APIGateway
    APIGateway --> AuthConsent
    AuthConsent --> ConsentStore
    AuthConsent --> EntitlementEngine
    EntitlementEngine --> GovtAdapter
    EntitlementEngine --> PolicyService
    EntitlementEngine --> KnowledgeGraph
    KnowledgeGraph --> HospitalLayer
    HospitalLayer --> TPAInsurer
    HospitalLayer --> HospitalPortal
    HospitalLayer --> ClaimsService
    ClaimsService --> Notifications

    %% Cross-cutting concerns
    APIGateway -.->|Logs| AuditLogs
    AuthConsent -.->|Logs| AuditLogs
    EntitlementEngine -.->|Logs| AuditLogs
    ClaimsService -.->|Logs| AuditLogs
    Notifications -.->|Logs| AuditLogs

    APIGateway -.->|Metrics| Analytics
    AuthConsent -.->|Metrics| Analytics
    EntitlementEngine -.->|Metrics| Analytics
    ClaimsService -.->|Metrics| Analytics
    Notifications -.->|Metrics| Analytics

    style CitizenApp fill:#e1f5ff
    style APIGateway fill:#fff4e1
    style AuthConsent fill:#ffe1f5
    style EntitlementEngine fill:#e1ffe1
    style KnowledgeGraph fill:#f5e1ff
    style HospitalLayer fill:#ffe1e1
    style ClaimsService fill:#ffffe1
    style Notifications fill:#e1ffff
    style Analytics fill:#f0f0f0
    style AuditLogs fill:#f0f0f0
```

## Component Descriptions

- **Citizen App (Web/Mobile)**: User-facing application for citizens to interact with the system
- **API Gateway**: Entry point that routes requests and handles common concerns
- **Auth & Consent Service**: Handles authentication and manages user consent
- **Consent Store**: Persistent storage for consent records
- **Entitlement Engine**: Core service that determines user entitlements and eligibility
- **Govt Eligibility Adapter**: Read-only adapter for government eligibility data
- **Employer / Bank Policy Service**: Service managing employer and bank policies
- **Insurance Knowledge Graph**: Knowledge base containing insurance information and relationships
- **Hospital Integration Layer**: Integration layer connecting to various hospital systems
- **TPA / Insurer APIs**: Third-party administrator and insurer API integrations
- **Hospital Portal**: Portal for hospital interactions
- **Claims Assistance Service**: Service that assists with claims processing
- **Notifications**: Multi-channel notification service (SMS, WhatsApp, Email)
- **Analytics & Reporting**: System for analytics and reporting
- **Audit & Compliance Logs**: Logging system for audit and compliance requirements



