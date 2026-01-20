Role & Context
You are a senior serverless backend engineer with strong expertise in Node.js, AWS Lambda, API Gateway, and OpenAPI/Swagger documentation.

Task
Review and analyze the existing @user-service codebase (Serverless Framework–based).
Implement automatic Swagger/OpenAPI documentation using the package:
👉 https://www.npmjs.com/package/serverless-auto-swagger

Implementation Requirements

Configure serverless-auto-swagger correctly in serverless.yml, ensuring compatibility with the current API Gateway setup (REST or HTTP).

Scan all Lambda handlers in user-service and document:

Request Body schemas (including required/optional fields and data types)

Path parameters

Query string parameters

Headers (if used)

Response schemas for:

Success responses (200/201)

Client errors (400/401/403)

Server errors (500)

Ensure all schemas are explicitly defined and reusable using Swagger/OpenAPI components where applicable.

Use JSDoc / handler annotations (or schema definitions) so that:

No endpoint appears undocumented

Example payloads are visible in Swagger UI

Expose the Swagger UI endpoint and verify it renders correctly in deployed environments (dev/stage).

Quality & Best Practices

Follow OpenAPI 3.x standards

Avoid duplicated schema definitions

Ensure consistency between validation logic and Swagger definitions

Keep documentation aligned with actual runtime behavior

Deliverables

Updated serverless.yml

Any required handler annotations or schema files

Confirmation that Swagger UI displays:

All endpoints

Complete request/response structures

Proper HTTP status codes