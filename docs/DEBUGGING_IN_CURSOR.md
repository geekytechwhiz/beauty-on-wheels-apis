# Debugging in Cursor

How to attach the debugger and hit breakpoints in Cursor (VS Code–based). Uses `.vscode/launch.json` configurations.

---

## 1. Set breakpoints in code

1. Open the file you want to debug (e.g. `apps/organization-service/src/handlers/createOrganization.ts`).
2. Click in the **gutter** (left of the line numbers) on the line where execution should pause. A red dot appears = breakpoint.
3. You can add **conditional breakpoints** (right‑click the dot → Edit Breakpoint) or **logpoints** (log without stopping).

Breakpoints work in **TypeScript** (`.ts`); the debugger uses source maps to map compiled JS back to your TS.

---

## 2. Run with the debugger (launch)

1. Open the **Run and Debug** view: **Ctrl+Shift+D** (Windows/Linux) or **Cmd+Shift+D** (macOS), or click the play-with-bug icon in the sidebar.
2. In the dropdown at the top, pick a configuration:
   - **Debug organization-service (serverless offline)** – **Use this for organization-service.** Runs `node --inspect` with serverless-offline so the debugger attaches to the process that runs your Lambda handlers. Set breakpoints in handler files (e.g. `createOrganization.ts`), press F5, then send a request (e.g. POST to `http://localhost:3000/dev/organization`) – the debugger will pause on your breakpoints.
   - **Debug organization-service with Nx** – runs `nx serve organization-service` (attaches to the Nx process; breakpoints in app code may not hit).
   - **Debug @api-hub/user-service with Nx** – user-service.
   - **Debug order-service with Nx** – order-service.
3. Press **F5** (or click the green play button) to **Launch**.
4. When execution hits a line where you set a breakpoint, Cursor will pause. You can:
   - **Step Over (F10)**, **Step Into (F11)**, **Step Out (Shift+F11)**.
   - Inspect **Variables** and **Watch** in the sidebar.
   - Use the **Debug Console** to evaluate expressions.

---

## 3. Attach to an already-running process

Use this when you start the app yourself (e.g. `serverless offline` or `nx serve`) with Node inspect.

1. Start your app with the inspector enabled, for example:
   ```bash
   NODE_OPTIONS='--inspect=9229' pnpm exec nx serve organization-service
   ```
   Or for serverless-offline (from repo root):
   ```bash
   cd apps/organization-service && NODE_OPTIONS='--inspect=9229' npx serverless offline --stage dev
   ```
2. In Cursor: **Run and Debug** → select **Attach to Node (inspect)**.
3. Press **F5** (or click the green play button). The debugger attaches to the process listening on port **9229**.
4. Trigger the code path you care about (e.g. call the API). Execution will pause on your breakpoints.

**Note:** If you use a different port, change the **port** in the "Attach to Node (inspect)" entry in `.vscode/launch.json` (e.g. `9232` for organization-service Nx serve).

---

## 4. Launch configurations in `.vscode/launch.json`

| Configuration                     | What it does                                      | Port |
|-----------------------------------|---------------------------------------------------|------|
| Debug organization-service with Nx| Runs `nx serve organization-service` with debug   | 9232 |
| Debug @api-hub/user-service with Nx| Runs `nx serve @api-hub/user-service` with debug | 9230 |
| Debug order-service with Nx       | Runs `nx serve order-service` with debug          | 9231 |
| Attach to Node (inspect)         | Attaches to a Node process already using `--inspect` | 9229 |

To use a different port when attaching, start your process with e.g. `--inspect=9230` and set the same port in the "Attach to Node (inspect)" config.

---

## 5. Debugging Lambda handlers (serverless-offline)

To debug a specific handler (e.g. Create Organization) when it’s invoked via serverless-offline:

1. Set breakpoints in the handler (e.g. `createOrganization.ts`).
2. Start serverless-offline with inspect:
   ```bash
   cd apps/organization-service
   NODE_OPTIONS='--inspect=9229' npx serverless offline --stage dev
   ```
3. In Cursor, run **Attach to Node (inspect)** (F5).
4. Send a request to the local endpoint (e.g. POST to `http://localhost:3000/dev/organization`). The debugger should stop at your breakpoints when the Lambda runs.

If breakpoints don’t bind correctly, ensure the service is built with **source maps** (e.g. `sourcemap: true` in esbuild/serverless-esbuild).

---

## 6. Quick reference

- **F5** – Start/Continue
- **F9** – Toggle breakpoint
- **F10** – Step Over
- **F11** – Step Into
- **Shift+F11** – Step Out
- **Ctrl+Shift+F5** / **Cmd+Shift+F5** – Restart debug session
