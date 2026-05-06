import { SourceFile } from "ts-morph";
import { hasRawLambdaHandler } from "../scanner/pattern-detector";

export function migrateConsumer(file: SourceFile): boolean {
  if (!hasRawLambdaHandler(file)) return false;

  file.addImportDeclaration({
    moduleSpecifier: "@api-hub/event-platform",
    namedImports: ["createEventHandler", "onEvent"],
  });

  file.getFunctions().forEach((fn) => {
    if (fn.getName() === "handler") {
      fn.replaceWithText(`
        export const handler = createEventHandler([
          onEvent(EVENT_DEFINITION, async ({ payload, meta }) => {
            // TODO: move existing logic
          })
        ]);
      `);
    }
  });

  return true;
}