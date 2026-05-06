import { Project } from "ts-morph";
import path from "path";
import { parseCliArgs } from "./utils/cli";
import { scanFiles } from "./scanner/file-scanner";
import { migratePublisher } from "./transformers/publisher.transformer";
import { migrateConsumer } from "./transformers/consumer.transformer";
import { enforceTenant } from "./transformers/tenant.transformer";
import { cleanupAwsSdk } from "./transformers/cleanup.transformer";
import fs from "fs";

async function run() {
  const options = parseCliArgs();

  const tsconfigPath =
    options.tsconfig || `${options.project}/tsconfig.json`;

  console.log(`📦 Project: ${options.project}`);
  console.log(`⚙️  TSConfig: ${tsconfigPath}`);
  console.log(`🧪 Dry Run: ${options.dryRun ? "YES" : "NO"}`);
  console.log(`TSConfig exists: ${fs.existsSync(tsconfigPath)}`);

  // 🔥 CRITICAL FIX
  const project = new Project({
    tsConfigFilePath: fs.existsSync(tsconfigPath)
      ? tsconfigPath
      : undefined,
    skipAddingFilesFromTsConfig: true, // ✅ IMPORTANT
  });

  // 🔥 FORCE LOAD FILES (DO NOT RELY ON TSCONFIG)
  const sourcePattern = path.join(options.project, "**/*.ts");

  console.log("📂 Loading files from:", sourcePattern);

  project.addSourceFilesAtPaths(sourcePattern);

  const files = scanFiles(project);

  console.log("📊 Files detected:", files.length);

  let modifiedCount = 0;

  for (const file of files) {
    let modified = false;

    modified ||= migratePublisher(file);
    modified ||= migrateConsumer(file);
    modified ||= enforceTenant(file);
    modified ||= cleanupAwsSdk(file);

    if (modified) {
      modifiedCount++;

      if (options.verbose) {
        console.log(`✔ Updated: ${file.getFilePath()}`);
      }

      if (!options.dryRun) {
        await file.save();
      }
    }
  }

  if (!options.dryRun) {
    await project.save();
  }

  console.log("\n🚀 Migration complete");
  console.log(`📊 Files modified: ${modifiedCount}`);
}

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});