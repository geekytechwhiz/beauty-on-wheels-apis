/**
 * File Merger
 * Intelligently merges generated code into existing files
 */

import { readFileSync, existsSync } from 'fs';

export class FileMerger {
  /**
   * Merge DTO type into existing internal.ts file
   */
  mergeDTO(filePath: string, newDTO: string, dtoType: string): { merged: boolean; content: string } {
    if (!existsSync(filePath)) {
      // Create new file with header
      const header = `/**
 * Internal DTO Types
 * These match the models from user-service
 */

`;
      return { merged: true, content: header + newDTO + '\n' };
    }

    let content = readFileSync(filePath, 'utf-8');
    
    // Check if DTO already exists
    const itemTypeMatch = newDTO.match(/export interface (\w+)/);
    const itemType = itemTypeMatch?.[1];
    const typesToCheck = [dtoType, itemType].filter(Boolean) as string[];
    
    const alreadyExists = typesToCheck.some(type => 
      content.includes(`export interface ${type}`) || 
      content.includes(`export type ${type}`)
    );

    if (alreadyExists) {
      return { merged: false, content };
    }

    // Append new DTO
    const trimmed = content.trimEnd();
    const newContent = trimmed + (trimmed.endsWith('\n') ? '' : '\n') + '\n' + newDTO + '\n';
    
    return { merged: true, content: newContent };
  }

  /**
   * Merge helper method into existing utility file
   */
  mergeHelper(filePath: string, newHelper: string, functionName: string): { merged: boolean; content: string } {
    if (!existsSync(filePath)) {
      // Create new file with imports
      const header = `/**
 * FHIR ${this.getCategoryFromPath(filePath)} Utilities
 */

import { Reference } from '../models/r4/common';

/**
 * Create a FHIR reference
 */
export function createReference(
  resourceType: string,
  id: string,
  display?: string
): Reference {
  return {
    reference: \`\${resourceType}/\${id}\`,
    type: resourceType,
    ...(display && { display }),
  };
}

`;
      return { merged: true, content: header + newHelper + '\n' };
    }

    let content = readFileSync(filePath, 'utf-8');
    
    // Check if helper already exists
    if (content.includes(`function ${functionName}`)) {
      return { merged: false, content };
    }

    // Ensure Reference is imported if not present
    if (newHelper.includes('Reference') && !content.includes("import { Reference }")) {
      // Find the import section and add Reference if needed
      const importMatch = content.match(/(import.*from.*common[^;]*;)/);
      if (importMatch) {
        // Update existing import
        const existingImport = importMatch[1];
        if (!existingImport.includes('Reference')) {
          content = content.replace(existingImport, existingImport.replace('}', ', Reference }'));
        }
      } else {
        // Add new import at top
        const firstImport = content.match(/^import.*$/m);
        if (firstImport) {
          const importIndex = firstImport.index || 0;
          const before = content.substring(0, importIndex);
          const after = content.substring(importIndex);
          content = before + "import { Reference } from '../models/r4/common';\n" + after;
        }
      }
    }

    // Find insertion point (before last export or at end)
    const lastExportIndex = content.lastIndexOf('export function');
    if (lastExportIndex !== -1) {
      // Find end of last function - look for closing brace with proper indentation
      let searchIndex = lastExportIndex;
      let braceCount = 0;
      let foundStart = false;
      let functionEnd = -1;
      
      while (searchIndex < content.length) {
        if (content[searchIndex] === '{') {
          braceCount++;
          foundStart = true;
        } else if (content[searchIndex] === '}') {
          braceCount--;
          if (foundStart && braceCount === 0) {
            functionEnd = searchIndex + 1;
            break;
          }
        }
        searchIndex++;
      }
      
      if (functionEnd !== -1) {
        const before = content.substring(0, functionEnd);
        const after = content.substring(functionEnd);
        return { merged: true, content: before + '\n\n' + newHelper + '\n' + after };
      }
    }

    // Append at end
    const trimmed = content.trimEnd();
    return { merged: true, content: trimmed + '\n\n' + newHelper + '\n' };
  }

  /**
   * Merge service client method into existing class
   */
  mergeServiceClientMethod(filePath: string, newMethod: string, methodName: string): { merged: boolean; content: string } {
    if (!existsSync(filePath)) {
      return { merged: false, content: '' };
    }

    let content = readFileSync(filePath, 'utf-8');
    
    // Check if method already exists
    const methodPattern = new RegExp(`async\\s+${methodName}\\s*\\(`);
    if (methodPattern.test(content)) {
      // Method exists - could update it, but for now skip
      return { merged: false, content };
    }

    // Find class closing brace and insert before it
    const classMatch = content.match(/(export class \w+[\s\S]*?)(\n\})/);
    if (classMatch) {
      const before = classMatch[1];
      const after = classMatch[2];
      return { merged: true, content: before + '\n  ' + newMethod.replace(/\n/g, '\n  ') + after };
    }

    return { merged: false, content };
  }

  /**
   * Update index.ts exports
   */
  updateIndexExports(filePath: string, exports: {
    model?: string;
    adapter?: string;
    category?: string;
  }): { updated: boolean; content: string } {
    if (!existsSync(filePath)) {
      return { updated: false, content: '' };
    }

    let content = readFileSync(filePath, 'utf-8');
    let updated = false;

    // Add model export
    if (exports.model) {
      const modelExport = `export * from './models/r4/${exports.model}';`;
      if (!content.includes(modelExport)) {
        const modelsSection = content.match(/(\/\/ Models[\s\S]*?)(?=\/\/ Adapters|\/\/ Utilities|$)/);
        if (modelsSection) {
          content = content.replace(modelsSection[0], modelsSection[0] + '\n' + modelExport);
          updated = true;
        }
      }
    }

    // Add adapter export
    if (exports.adapter && exports.category) {
      const adapterExport = `export * from './adapters/${exports.category}/${exports.adapter}.adapter';`;
      if (!content.includes(adapterExport)) {
        const adaptersSection = content.match(/(\/\/ Adapters[\s\S]*?)(?=\/\/ Utilities|$)/);
        if (adaptersSection) {
          content = content.replace(adaptersSection[0], adaptersSection[0] + '\n' + adapterExport);
          updated = true;
        }
      }
    }

    return { updated, content };
  }

  private getCategoryFromPath(path: string): string {
    const match = path.match(/utils\/(\w+)\.ts/);
    return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1) : 'Utility';
  }
}

