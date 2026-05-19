import { SourceFile } from "ts-morph";

export function cleanupAwsSdk(file: SourceFile): boolean {
  let modified = false;

  file.getImportDeclarations().forEach((imp) => {
    const module = imp.getModuleSpecifierValue();

    if (
      module.includes("@aws-sdk/client-eventbridge") ||
      module.includes("@aws-sdk/client-sqs") ||
      module.includes("@aws-sdk/client-sns")
    ) {
      imp.remove();
      modified = true;
    }
  });

  return modified;
}