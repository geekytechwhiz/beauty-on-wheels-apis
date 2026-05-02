import { Project, SourceFile } from "ts-morph";

export function scanFiles(project: Project): SourceFile[] {
  return project.getSourceFiles(); // ✅ FIXED
}