import { SourceFile } from "ts-morph";
import { hasPublisherPattern } from "../scanner/pattern-detector";

export function migratePublisher(file: SourceFile): boolean {
  if (!hasPublisherPattern(file)) return false;

  let modified = false;

  // Remove AWS SDK imports
  file.getImportDeclarations().forEach((imp) => {
    if (
      imp.getModuleSpecifierValue().includes("@aws-sdk/client-eventbridge")
    ) {
      imp.remove();
      modified = true;
    }
  });

  // Add event-platform import
  file.addImportDeclaration({
    moduleSpecifier: "@api-hub/event-platform",
    namedImports: ["createSnsPublishEvent"],
  });

  // Replace publish functions
  file.getFunctions().forEach((fn) => {
    if (fn.getName()?.toLowerCase().includes("publish")) {
      fn.setBodyText(`
        const publish = createSnsPublishEvent({
          topicArnEnvKey: 'USER_EVENTS_TOPIC_ARN'
        });

        await publish(EVENT_DEFINITION, {
          payload: event,
          meta: {
            correlationId: event?.correlationId,
            tenantId: event?.tenantId,
          }
        });
      `);

      modified = true;
    }
  });

  return modified;
}