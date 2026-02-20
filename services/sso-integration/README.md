# MyVitalRx SSO - Launch Flow

Production SSO implementation for HMS (Hospital Management System) integration. Enables launch token verification and JWT session creation with **no changes required on HMS side**.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sso/launch` | GET | SSO launch - verify launch token, create session, redirect |
| `/sso/register` | POST | Register HMS client (get client_id, launch_secret) |

## Quick Start

```bash
npm install
npm run build

# Deploy
export JWT_SECRET=your-secure-256-bit-secret
npx serverless deploy --stage dev
```

After deploy, set `API_BASE_URL` to the ServiceEndpoint and redeploy, or pass at deploy:
```bash
API_BASE_URL=https://xxx.execute-api.us-east-1.amazonaws.com/dev npx serverless deploy
```

## Launch Flow

1. **Register HMS** → POST `/sso/register` → receive `client_id`, `launch_secret`, `launch_url`
2. **HMS generates token** → JWT with user info, signed with `launch_secret`
3. **HMS redirects user** → `GET /sso/launch?launch_token=JWT`
4. **MyVitalRx** → Verifies token, creates session JWT, redirects to app with `session_token`

See [HMS_LAUNCH_INTEGRATION.md](./HMS_LAUNCH_INTEGRATION.md) for full integration guide.

## Project Structure

```
src/
├── handlers/
│   ├── health.handler.ts
│   └── sso/
│       ├── launch.handler.ts    # /sso/launch endpoint
│       └── register.handler.ts
├── services/
│   ├── launch.service.ts       # Token verification + session creation
│   ├── token.service.ts        # JWT session handling
│   └── hms-client.service.ts   # HMS client registry (DynamoDB)
├── types/
└── utils/
```
