export interface CodeAlias {
  source: string;
  code: string;
  display?: string;
}

export class CodeAliasRegistry {
  private readonly aliases = new Map<string, CodeAlias[]>();

  register(system: string, alias: CodeAlias): void {
    const existing = this.aliases.get(system) ?? [];
    existing.push(alias);
    this.aliases.set(system, existing);
  }

  resolve(system: string, value: string): CodeAlias | undefined {
    const entries = this.aliases.get(system);
    if (!entries?.length) {
      return undefined;
    }

    const normalized = String(value).toLowerCase();
    return entries.find(
      (entry) => entry.source.toLowerCase() === normalized,
    );
  }

  reverse(system: string, code: string): string | undefined {
    const entries = this.aliases.get(system);
    if (!entries?.length) {
      return undefined;
    }

    const normalized = String(code).toLowerCase();
    const match = entries.find(
      (entry) => entry.code.toLowerCase() === normalized,
    );

    return match?.display ?? match?.source;
  }
}

export function createDefaultAliasRegistry(): CodeAliasRegistry {
  const registry = new CodeAliasRegistry();

  const genderAliases: CodeAlias[] = [
    { source: 'male', code: 'male', display: 'Male' },
    { source: 'female', code: 'female', display: 'Female' },
    { source: 'other', code: 'other', display: 'Other' },
    { source: 'unknown', code: 'unknown', display: 'Unknown' },
  ];

  for (const alias of genderAliases) {
    registry.register('http://hl7.org/fhir/administrative-gender', alias);
  }

  return registry;
}
