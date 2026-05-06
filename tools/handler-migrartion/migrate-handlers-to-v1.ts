import {
  Project,
  SyntaxKind,
  type CallExpression,
  type ImportDeclaration,
  type SourceFile,
} from "ts-morph";
import fs from "node:fs";
import path from "path";

function findApiHubRoot(): string {
  let dir = path.resolve(process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, "tsconfig.base.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "Could not find api-hub repo root (need tsconfig.base.json on path from cwd). Run from inside the monorepo."
      );
    }
    dir = parent;
  }
}

function isWithLambdaHandlerCall(init: unknown): init is CallExpression {
  if (!init || typeof init !== "object" || !("asKind" in init)) return false;
  const call = (init as { asKind: (k: SyntaxKind) => CallExpression | undefined }).asKind(
    SyntaxKind.CallExpression
  );
  if (!call) return false;
  return call.getExpression().getText() === "withLambdaHandler";
}

function addNamedImportIfMissing(decl: ImportDeclaration, name: string) {
  if (!decl.getNamedImports().some((n) => n.getName() === name)) {
    decl.addNamedImport(name);
  }
}

function ensureMiddlewareImports(
  file: SourceFile,
  responseMethod: "successResponse" | "createdResponse"
) {
  const decl = file
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === "@api-hub/middleware");

  if (!decl) {
    file.addImportDeclaration({
      moduleSpecifier: "@api-hub/middleware",
      namedImports: ["  withApiHandler", responseMethod],
    });
    return;
  }

  addNamedImportIfMissing(decl, "  withApiHandler");
  addNamedImportIfMissing(decl, responseMethod);
}

function upgradeImportsAfterMigration(
  file: SourceFile,
  responseMethod: "successResponse" | "createdResponse"
) {
  for (const decl of file.getImportDeclarations()) {
    const spec = decl.getModuleSpecifierValue();
    if (
      spec !== "@api-hub/middleware" &&
      spec !== "@api-hub/utils" &&
      spec !== "@api-hub/fhir"
    ) {
      continue;
    }
    const wl = decl.getNamedImports().find((n) => n.getName() === "withLambdaHandler");
    if (!wl) continue;
    wl.remove();
    ensureMiddlewareImports(file, responseMethod);
    if (decl.getNamedImports().length === 0) {
      decl.remove();
    }
  }
}

const repoRoot = findApiHubRoot();

/** App folder under `apps/` (e.g. user-service, metadata-registry-service). */
const appName =
  process.argv[2] ??
  process.env.MIGRATE_HANDLERS_APP ??
  "user-service";

const handlersDir = path.join(
  repoRoot,
  "apps",
  appName,
  "src",
  "handlers",
  "v1"
);

if (!fs.existsSync(handlersDir)) {
  throw new Error(
    `Migration target directory not found:\n  ${handlersDir}\n` +
      `repo root: ${repoRoot} (from cwd: ${process.cwd()})`
  );
}

const handlerPaths = fs
  .readdirSync(handlersDir, { withFileTypes: true })
  .filter(
    (e) =>
      e.isFile() &&
      e.name.endsWith(".ts") &&
      !e.name.endsWith(".d.ts")
  )
  .map((e) => path.join(handlersDir, e.name));

const project = new Project({
  tsConfigFilePath: path.join(repoRoot, "tsconfig.base.json"),
});

const files: SourceFile[] = [];
for (const p of handlerPaths) {
  const existing = project.getSourceFile(p);
  files.push(existing ?? project.addSourceFileAtPath(p));
}

console.log(`Scanning ${files.length} file(s) under:\n  ${handlersDir}\n(app: ${appName})\n`);

let migratedCount = 0;
let skippedCount = 0;

for (const file of files) {
  const targetDecl = file.getVariableDeclarations().find((vd) =>
    isWithLambdaHandlerCall(vd.getInitializer())
  );

  if (!targetDecl) {
    if (file.getFullText().includes("withLambdaHandler")) {
      console.warn("Skipped (unexpected pattern):", file.getFilePath());
      skippedCount++;
    }
    continue;
  }

  const initializer = targetDecl.getInitializer();
  if (!initializer || !isWithLambdaHandlerCall(initializer)) continue;

  const callExpr = initializer;
  const args = callExpr.getArguments();
  const handlerFn = args[0];
  const options = args[1];

  if (!handlerFn) {
    console.warn("No handler argument:", file.getFilePath());
    skippedCount++;
    continue;
  }

  const optionsText = options?.getText() ?? "";
  const validatorText = optionsText.includes("validator")
    ? optionsText.match(/validator:\s*([a-zA-Z0-9_]+)/)?.[1]
    : undefined;

  const useCreatedMatch = optionsText.match(/useCreated:\s*(true|false)/);
  const useCreated = useCreatedMatch?.[1] === "true";
  const responseMethod = useCreated ? "createdResponse" : "successResponse";

  const operation = path
    .basename(file.getFilePath())
    .replace(".ts", "")
    .replace(/[^a-zA-Z0-9]/g, ".");

  const exportName = targetDecl.getName();

  const newInitializer = `  withApiHandler(
  {
    operation: '${operation}',
    ${validatorText ? `validator: (req) => ${validatorText}(req as any),` : ""}
  },
  async (req) => {
    const correlationId =
      (req.context as { correlationId?: string }).correlationId ?? 'unknown';

    const result = await ((${handlerFn.getText()}) as any)(req);

    return ${responseMethod}(result, undefined, { correlationId });
  }
)`;

  targetDecl.setInitializer(newInitializer);
  upgradeImportsAfterMigration(file, responseMethod);

  migratedCount++;
  console.log("Migrated:", file.getFilePath(), `(export: ${exportName})`);
}

project.save().then(() => {
  console.log(
    `✅ Migration complete — ${migratedCount} file(s) updated, ${skippedCount} skipped`
  );
  if (files.length === 0) {
    console.warn("No .ts files found in target directory.");
  } else if (migratedCount === 0 && skippedCount === 0) {
    const stillLegacy = files.filter((f) =>
      f.getFullText().includes("withLambdaHandler")
    );
    if (stillLegacy.length > 0) {
      console.warn(
        `${stillLegacy.length} file(s) still mention withLambdaHandler but did not match the expected export pattern. Examples:`
      );
      stillLegacy.slice(0, 5).forEach((f) => console.warn("  -", f.getFilePath()));
    } else {
      console.log(
        "(Nothing to do: no withLambdaHandler wrappers found — already on   withApiHandler, or handlers use a different pattern.)"
      );
    }
  }
});
