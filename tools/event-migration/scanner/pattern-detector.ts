import { SourceFile } from "ts-morph";

export function hasPublisherPattern(file: SourceFile): boolean {
  const text = file.getFullText();

  return (
    text.includes("EventBridgeClient") ||
    text.includes("PutEventsCommand") ||
    text.includes("publish(")
  );
}

export function hasRawLambdaHandler(file: SourceFile): boolean {
  const text = file.getFullText();

  return (
    text.includes("exports.handler") ||
    text.includes("export const handler") ||
    text.includes("handler = async")
  );
}