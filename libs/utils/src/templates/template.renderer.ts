import { TemplateData } from '../types/template.types';

function getValue(obj: TemplateData, key: string) {
  return key.split('.').reduce((acc: any, k) => acc?.[k], obj);
}

export function processIfBlocks(input: string, data: TemplateData): string {
  return input.replace(
    /{{#if\s+([\w.]+)}}([\s\S]*?){{\/if}}/g,
    (_, key, inner) => {
      const val = getValue(data, key.trim());
      return val ? renderString(inner, data) : '';
    }
  );
}

export function renderString(input: string, data: TemplateData): string {
  if (!input) return '';

  let result = processIfBlocks(input, data);

  result = result.replace(/{{(.*?)}}/g, (_, key) => {
    const val = getValue(data, key.trim());
    return val == null ? '' : String(val);
  });

  return result;
}