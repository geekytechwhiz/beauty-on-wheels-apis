import * as fs from 'fs';
import * as path from 'path';
import { assertValidRuleSet } from './index';

const rulesRoot = path.join(__dirname, '../../../rules');

describe('libs/rules JSON (RuleSet compatibility)', () => {
  it('templates/master/v1/care-plan-basic.json has valid rules[]', () => {
    const file = path.join(rulesRoot, 'templates/master/v1/care-plan-basic.json');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as { rules?: unknown };
    expect(Array.isArray(doc.rules)).toBe(true);
    assertValidRuleSet(doc.rules);
  });

  it('global/rules.json has valid rules[]', () => {
    const file = path.join(rulesRoot, 'global/rules.json');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as { rules?: unknown };
    expect(Array.isArray(doc.rules)).toBe(true);
    assertValidRuleSet(doc.rules);
  });
});
