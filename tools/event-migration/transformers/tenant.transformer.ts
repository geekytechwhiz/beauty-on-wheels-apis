import { SourceFile } from "ts-morph";

export function enforceTenant(file: SourceFile): boolean {
  const text = file.getFullText();

  if (!text.includes("publish(")) return false;

  if (text.includes("tenantId")) return false;

  file.replaceWithText(
    text.replace(
      "meta: {",
      "meta: { tenantId: tenantId,"
    )
  );

  return true;
}