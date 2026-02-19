# AWS Serverless SSO — Overall Code Flow

---

## Project Structure at a Glance

```
SSO-1/
├── serverless.yml                        # Infrastructure: Lambda + API GW + Cognito
├── package.json                          # Dependencies & scripts
├── tsconfig.json                         # TypeScript config
├── API.md                                # API endpoint documentation
└── src/
    ├── types/index.ts                    # Shared TypeScript interfaces
    ├── utils/
    │   ├── response.ts                   # HTTP response helpers
    │   └── logger.ts                     # Structured JSON logger
    ├── services/
    │   ├── cognitoService.ts             # AWS SDK + Cognito token calls
    │   └── tokenService.ts              # JWT verification (aws-jwt-verify)
    └── handlers/
        ├── auth/
        │   ├── login.ts                  # GET /auth/login
        │   ├── callback.ts               # GET /auth/callback
        │   ├── logout.ts                 # GET /auth/logout
        │   └── refresh.ts                # POST /auth/refresh
        ├── authorizer/
        │   └── jwtAuthorizer.ts          # Custom Lambda JWT authorizer
        └── api/
            ├── profile.ts                # GET /api/profile  (protected)
            └── health.ts                 # GET /health       (public)
```

---

## 1. Infrastructure Deployment Flow

```
Developer runs: npm run deploy
        │
        ▼
serverless.yml is read by Serverless Framework
        │
        ├── CloudFormation creates:
        │       ├── CognitoUserPool          → User Pool (email login, auto-verify)
        │       ├── CognitoUserPoolClient    → App client (OAuth2, no secret)
        │       └── CognitoUserPoolDomain    → Hosted UI domain (globally unique)
        │
        ├── esbuild bundles each .ts handler → individual .js Lambda zips
        │
        └── API Gateway REST API is created with:
                ├── GET  /auth/login       → login Lambda
                ├── GET  /auth/callback    → callback Lambda
                ├── GET  /auth/logout      → logout Lambda
                ├── POST /auth/refresh     → refresh Lambda
                ├── GET  /api/profile      → profile Lambda  ← Cognito Authorizer
                └── GET  /health           → health Lambda
```

---

## 2. Login Flow  `GET /auth/login`

```
Browser
  │
  │  GET /auth/login?state=xxx&identity_provider=Google
  ▼
API Gateway  (no auth check — public route)
  │
  ▼
src/handlers/auth/login.ts  →  handler()
  │
  ├── 1. getCognitoConfig()               [cognitoService.ts]
  │       └── reads env vars:
  │             COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID,
  │             COGNITO_DOMAIN, CALLBACK_URL
  │
  ├── 2. buildLoginUrl(config)            [cognitoService.ts]
  │       └── builds URL:
  │             https://<domain>.auth.<region>.amazoncognito.com/login
  │             ?client_id=xxx
  │             &response_type=code
  │             &scope=email+openid+profile
  │             &redirect_uri=<CALLBACK_URL>
  │
  └── 3. redirect(loginUrl)               [utils/response.ts]
          └── returns HTTP 302 → Location: <Cognito Hosted UI URL>

Browser follows redirect → User sees Cognito login page
User enters credentials / picks Google / SAML etc.
Cognito authenticates → redirects to CALLBACK_URL?code=xxx
```

---

## 3. Callback Flow  `GET /auth/callback`

```
Cognito
  │
  │  GET /auth/callback?code=6b7a3c1d-xxxx
  ▼
API Gateway  (public route)
  │
  ▼
src/handlers/auth/callback.ts  →  handler()
  │
  ├── 1. Read query params
  │       ├── ?error=...  → return 400 badRequest()
  │       └── ?code=...   → continue
  │
  ├── 2. getCognitoConfig()               [cognitoService.ts]
  │
  ├── 3. exchangeCodeForTokens(code, config)  [cognitoService.ts]
  │       │
  │       └── POST https://<domain>/oauth2/token
  │               body: grant_type=authorization_code
  │                     client_id=xxx
  │                     code=6b7a3c1d-xxxx
  │                     redirect_uri=<CALLBACK_URL>
  │               │
  │               └── Cognito returns:
  │                     { id_token, access_token, refresh_token, expires_in }
  │
  ├── 4. decodeTokenPayload(idToken)      [tokenService.ts]
  │       └── base64-decode JWT payload (no network call)
  │               → CognitoJwtPayload { sub, email, name, groups, ... }
  │
  ├── 5. payloadToUserProfile(payload)    [tokenService.ts]
  │       └── maps raw claims → UserProfile { userId, email, groups, ... }
  │
  └── 6. ok({ tokens, user })            [utils/response.ts]
          └── returns HTTP 200 JSON
                { success:true, data: { tokens:{...}, user:{...} } }
```

---

## 4. Token Refresh Flow  `POST /auth/refresh`

```
Client (holds an expired access token but valid refresh token)
  │
  │  POST /auth/refresh
  │  Body: { "refreshToken": "eyJjdHki..." }
  ▼
API Gateway  (public route)
  │
  ▼
src/handlers/auth/refresh.ts  →  handler()
  │
  ├── 1. Parse + validate request body
  │       ├── no body          → 400 MISSING_BODY
  │       ├── invalid JSON     → 400 INVALID_JSON
  │       └── no refreshToken  → 400 MISSING_REFRESH_TOKEN
  │
  ├── 2. getCognitoConfig()               [cognitoService.ts]
  │
  ├── 3. refreshAccessToken(refreshToken, config)  [cognitoService.ts]
  │       │
  │       └── POST https://<domain>/oauth2/token
  │               body: grant_type=refresh_token
  │                     client_id=xxx
  │                     refresh_token=eyJjdHki...
  │               │
  │               ├── Success → { id_token, access_token, expires_in }
  │               └── Expired → Cognito throws NotAuthorizedException
  │
  ├── 4a. Token expired/revoked → 401 UNAUTHORIZED
  │
  └── 4b. ok({ idToken, accessToken, expiresIn, tokenType })
              └── returns HTTP 200  (refresh token NOT rotated)
```

---

## 5. Logout Flow  `GET /auth/logout`

```
Client
  │
  │  GET /auth/logout?username=janedoe
  ▼
API Gateway  (public route)
  │
  ▼
src/handlers/auth/logout.ts  →  handler()
  │
  ├── 1. getCognitoConfig()               [cognitoService.ts]
  │
  ├── 2. globalSignOut(username, config)  [cognitoService.ts]
  │       │
  │       └── AWS SDK: AdminUserGlobalSignOutCommand
  │               UserPoolId: xxx
  │               Username: janedoe
  │               │
  │               └── Cognito invalidates ALL refresh tokens
  │                   for this user across every device
  │
  ├── 3. buildLogoutUrl(config)           [cognitoService.ts]
  │       └── https://<domain>/logout
  │             ?client_id=xxx
  │             &logout_uri=<LOGOUT_REDIRECT_URL>
  │
  └── 4. redirect(cognitoLogoutUrl)       [utils/response.ts]
          └── HTTP 302 → Cognito clears SSO session cookie
                       → redirects user to LOGOUT_REDIRECT_URL
```

---

## 6. Protected API Flow  `GET /api/profile`

```
Client (logged in, holds valid access token)
  │
  │  GET /api/profile
  │  Authorization: Bearer eyJraWQi...
  ▼
API Gateway
  │
  ├── Cognito User Pool Authorizer runs BEFORE Lambda
  │       ├── Extracts token from Authorization header
  │       ├── Fetches JWKS from Cognito (cached)
  │       ├── Verifies signature, expiry, issuer, audience
  │       ├── FAIL  → HTTP 401  "Unauthorized"  (Lambda never runs)
  │       └── PASS  → injects claims into requestContext.authorizer.claims
  │
  ▼
src/handlers/api/profile.ts  →  handler()
  │
  ├── 1. Read claims from event.requestContext.authorizer.claims
  │       (already verified — no extra network call needed)
  │       { sub, email, email_verified, name, cognito:groups, ... }
  │
  ├── 2a. Claims present → build UserProfile directly from claims (fast path)
  │
  ├── 2b. No claims → extractBearerToken(authHeader)  [tokenService.ts]
  │           └── fallback: call getUserBySdkToken(token, config)  [cognitoService.ts]
  │                   └── AWS SDK: GetUserCommand { AccessToken }
  │                           → fetches live attributes from User Pool
  │
  └── 3. ok(profile)                      [utils/response.ts]
          └── HTTP 200
                { success:true, data: { userId, email, groups, ... } }
```

---

## 7. Custom Lambda Authorizer Flow  `jwtAuthorizer`

> Alternative authorizer — attached to any route that needs custom logic beyond the built-in Cognito authorizer (e.g. injecting tenant ID, checking deny-lists).

```
API Gateway receives a request on a route using jwtAuthorizer
  │
  ▼
src/handlers/authorizer/jwtAuthorizer.ts  →  handler()
  │
  ├── 1. Extract token from event.authorizationToken
  │       └── must be "Bearer <token>" format
  │               └── missing/wrong format → throw "Unauthorized" → 401
  │
  ├── 2. verifyAccessToken(token, config)  [tokenService.ts]
  │       │
  │       └── CognitoJwtVerifier.create({ userPoolId, tokenUse:"access", clientId })
  │                 └── fetches + caches JWKS from Cognito
  │                 └── validates: signature, exp, iss, aud, token_use
  │                 │
  │                 ├── FAIL → throw "Unauthorized" → 401
  │                 └── PASS → returns CognitoJwtPayload
  │
  ├── 3. Build context from payload claims
  │       { userId, email, username, groups, tokenUse }
  │
  └── 4. buildIamPolicy(sub, "Allow", methodArn, context)
          └── returns IAM policy document to API Gateway
                {
                  principalId: "sub-uuid",
                  policyDocument: { Statement: [{ Effect:"Allow", Action:"execute-api:Invoke" }] },
                  context: { userId, email, groups }   ← available in downstream Lambda
                }
```

---

## 8. Health Check Flow  `GET /health`

```
Load balancer / monitoring tool
  │
  │  GET /health
  ▼
API Gateway  (public — no auth)
  │
  ▼
src/handlers/api/health.ts  →  handler()
  │
  └── ok({ status:"healthy", timestamp, service, version, region, stage })
          └── HTTP 200  (cold-start env vars read once and reused on warm invocations)
```

---

## 9. Utility Layer Flow

### `src/utils/response.ts`
```
Handler calls: ok(data) / redirect(url) / badRequest() / unauthorized() / internalServerError()
      │
      └── Builds APIGatewayProxyResult
              {
                statusCode: <number>,
                headers: { Content-Type, Access-Control-Allow-Origin, ... },
                body: JSON.stringify({ success, statusCode, message, data/error })
              }
```

### `src/utils/logger.ts`
```
createLogger("HandlerName")  →  Logger instance
      │
      ├── logger.setRequestId(event.requestContext.requestId)
      │       └── attaches Lambda request ID to every log line
      │
      └── logger.info / warn / error (message, meta)
              └── console.log(JSON.stringify({ level, message, timestamp,
                                               service, stage, requestId, ...meta }))
                      └── CloudWatch Logs auto-parses structured JSON
                          → queryable via CloudWatch Logs Insights
```

### `src/services/cognitoService.ts`
```
getCognitoConfig()         → reads env vars → CognitoConfig object
buildLoginUrl(config)      → builds Hosted UI /login URL
buildLogoutUrl(config)     → builds Hosted UI /logout URL
exchangeCodeForTokens()    → native fetch POST /oauth2/token (code grant)
refreshAccessToken()       → native fetch POST /oauth2/token (refresh grant)
getUserBySdkToken()        → AWS SDK GetUserCommand (live User Pool lookup)
globalSignOut()            → AWS SDK AdminUserGlobalSignOutCommand
```

### `src/services/tokenService.ts`
```
verifyAccessToken(token)   → aws-jwt-verify: fetches JWKS, verifies signature + claims
verifyIdToken(token)       → same, for id token
decodeTokenPayload(token)  → base64-decode JWT payload (no network, no verification)
payloadToUserProfile()     → maps CognitoJwtPayload → UserProfile
extractBearerToken()       → strips "Bearer " prefix from Authorization header
```

---

## 10. End-to-End SSO Sequence

```
 Client            API Gateway        Lambda             Cognito (AWS)
   │                   │                │                     │
   │─GET /auth/login──►│                │                     │
   │                   │─invoke────────►│ login.ts            │
   │                   │                │─buildLoginUrl()     │
   │◄──302 Location────│◄───────────────│                     │
   │                   │                │                     │
   │─────────────────────────────────────────────────────────►│ Hosted UI
   │                   │                │                     │ (user logs in)
   │◄─────────────────────────────────────────────────────────│
   │                   │                │                     │
   │─GET /auth/callback?code=xxx───────►│                     │
   │                   │─invoke────────►│ callback.ts         │
   │                   │                │─POST /oauth2/token─►│
   │                   │                │◄────tokens──────────│
   │◄──200 {tokens,user}───────────────│                     │
   │                   │                │                     │
   │─GET /api/profile──►│               │                     │
   │  Authorization: Bearer <token>     │                     │
   │                   │─validate JWT──────────────────────►  │ (JWKS cache)
   │                   │◄──claims injected──────────────────   │
   │                   │─invoke────────►│ profile.ts          │
   │◄──200 {UserProfile}───────────────│                     │
   │                   │                │                     │
   │─POST /auth/refresh►│               │                     │
   │  {refreshToken}   │─invoke────────►│ refresh.ts          │
   │                   │                │─POST /oauth2/token─►│
   │                   │                │◄────new tokens──────│
   │◄──200 {new tokens}────────────────│                     │
   │                   │                │                     │
   │─GET /auth/logout──►│               │                     │
   │  ?username=xxx    │─invoke────────►│ logout.ts           │
   │                   │                │─AdminGlobalSignOut─►│
   │                   │                │◄────OK──────────────│
   │◄──302 → Cognito logout────────────│                     │
   │──────────────────────────────────────────────────────────►│ clears cookie
   │◄──302 → LOGOUT_REDIRECT_URL───────────────────────────── │
```
