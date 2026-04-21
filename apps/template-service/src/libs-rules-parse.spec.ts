import * as fs from 'fs';
import * as path from 'path';
import { parseTemplateDocument } from '@api-hub/template';

const rulesRoot = path.join(__dirname, '../../../libs/rules');

describe('libs/rules template documents (parseTemplateDocument)', () => {
  it('parses care-plan-basic.json', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(rulesRoot, 'templates/master/v1/care-plan-basic.json'), 'utf8'),
    );
    const doc = parseTemplateDocument(raw);
    expect(doc.config.templateId).toBe('care-plan-basic');
    expect(doc.config.version).toBe('v1');
    expect(doc.rules.length).toBe(3);
    expect(doc.actions).toEqual([]);
  });

  it('parses global/rules.json', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(rulesRoot, 'global/rules.json'), 'utf8'));
    const doc = parseTemplateDocument(raw);
    expect(doc.config.ruleScope).toBe('GLOBAL');
    expect(doc.rules.length).toBe(5);
    expect(doc.actions).toEqual([]);
  });
});
