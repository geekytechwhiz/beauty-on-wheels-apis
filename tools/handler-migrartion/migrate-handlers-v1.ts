import {
    Project,
    SyntaxKind,
    type CallExpression,
  } from "ts-morph";
  import fs from "fs";
  import path from "path"; 
  
  function findRepoRoot(): string {
    let dir = process.cwd();
    while (!fs.existsSync(path.join(dir, "tsconfig.base.json"))) {
      const parent = path.dirname(dir);
      if (parent === dir) throw new Error("Repo root not found");
      dir = parent;
    }
    return dir;
  }
  
  function copyHandlers(src: string, dest: string) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  
    for (const file of fs.readdirSync(src)) {
      const srcFile = path.join(src, file);
      const destFile = path.join(dest, file);
  
      if (fs.statSync(srcFile).isFile() && file.endsWith(".ts")) {
        if (!fs.existsSync(destFile)) {
          fs.copyFileSync(srcFile, destFile);
          console.log("📁 Copied:", file);
        }
      }
    }
  }
  
  function isWithLambdaHandler(init: any): init is CallExpression {
    return (
      init &&
      init.getKind() === SyntaxKind.CallExpression &&
      init.getExpression().getText() === "withLambdaHandler"
    );
  }
  
  function transformHandlers(project: Project, handlersDir: string) {
    const files = project.addSourceFilesAtPaths(`${handlersDir}/*.ts`);
  
    let count = 0;
  
    for (const file of files) {
      const decl = file.getVariableDeclarations().find((v) =>
        isWithLambdaHandler(v.getInitializer())
      );
  
      if (!decl) continue;
  
      const call = decl.getInitializerIfKind(SyntaxKind.CallExpression)!;
      const handlerFn = call.getArguments()[0];
      const options = call.getArguments()[1];
  
      const validatorMatch = options?.getText().match(/validator:\s*([a-zA-Z0-9_]+)/);
      const validator = validatorMatch?.[1];
  
      const operation = path
        .basename(file.getFilePath())
        .replace(".ts", "")
        .replace(/[^a-zA-Z0-9]/g, ".");
  
      decl.setInitializer(`
  withApiHandler(
    {
      operation: '${operation}',
      ${validator ? `validator: (req) => ${validator}(req as any),` : ""}
    },
    async (req) => {
      return (${handlerFn?.getText()})(req);
    }
  )
  `);
  
      // Fix imports
      file.getImportDeclarations().forEach((d) => {
        if (d.getModuleSpecifierValue() === "@api-hub/middleware") {
          d.getNamedImports().forEach((n) => {
            if (n.getName() === "withLambdaHandler") n.remove();
          });
          if (!d.getNamedImports().some((n) => n.getName() === "withApiHandler")) {
            d.addNamedImport("withApiHandler");
          }
        }
      });
  
      count++;
      console.log("🔁 Transformed:", file.getBaseName());
    }
  
    return count;
  }
  
  function updateServerless(serverlessPath: string) {
    let content = fs.readFileSync(serverlessPath, "utf-8");
  
    const handlerRegex = /handler:\s*(src\/handlers\/(?!v1\/)[^\s]+)/g;
  
    let updatedCount = 0;
  
    content = content.replace(handlerRegex, (match, handlerPath) => {
      const newPath = handlerPath.replace(
        "src/handlers/",
        "src/handlers/v1/"
      );
  
      updatedCount++;
      console.log(`🔁 ${handlerPath} → ${newPath}`);
  
      return `handler: ${newPath}`;
    });
  
    fs.writeFileSync(serverlessPath, content);
  
    console.log(`✅ serverless.yml updated (${updatedCount} handlers)`);
  }
  
  async function main() {
    const repoRoot = findRepoRoot();
  
    const appName = process.argv[2];
    if (!appName) {
      console.error("❌ Provide app name: pnpm ts-node migrate-handlers-v1.ts user-service");
      process.exit(1);
    }
  
    const appPath = path.join(repoRoot, "apps", appName);
    const handlersSrc = path.join(appPath, "src/handlers");
    const handlersV1 = path.join(handlersSrc, "v1");
    const serverlessPath = path.join(appPath, "serverless.yml");
  
    console.log("\n🚀 Migrating:", appName);
  
    copyHandlers(handlersSrc, handlersV1);
  
    const project = new Project({
      tsConfigFilePath: path.join(repoRoot, "tsconfig.base.json"),
    });
  
    const transformed = transformHandlers(project, handlersV1);
  
    await project.save();
  
    updateServerless(serverlessPath);
  
    console.log(`\n✅ Done: ${transformed} handlers migrated`);
  }
  
  main();