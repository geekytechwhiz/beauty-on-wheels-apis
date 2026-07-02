import type { TemplateHistoryEntry } from '../mappers/template-http.dto';
import {
  buildHistoryFieldChangeMessages,
  formatHistoryEntriesForApi,
  formatHistoryValue,
} from './template-history-display.utils';

describe('template-history-display.utils', () => {
  it('formats label/value objects as human labels', () => {
    expect(
      formatHistoryValue({ labelKey: 'Chronic Disease', value: 'CHRONIC_DISEASE' }),
    ).toBe('Chronic Disease');
    expect(formatHistoryValue({ title: 'Goal Final 1', version: '1' })).toBe('Goal Final 1 v1');
    expect(formatHistoryValue(true)).toBe('Yes');
  });

  it('builds readable field change messages', () => {
    const messages = buildHistoryFieldChangeMessages(
      {
        Category: { labelKey: 'Chronic Disease', value: 'CHRONIC_DISEASE' },
        MaxGoalsAllowed: 10,
      },
      {
        Category: { labelKey: 'Wellness', value: 'WELLNESS' },
        MaxGoalsAllowed: 7,
      },
    );

    expect(messages).toContain("'Category' changed from Chronic Disease to Wellness.");
    expect(messages).toContain("'Max goals allowed' changed from 10 to 7.");
  });

  it('uses short update message for complex field values', () => {
    const messages = buildHistoryFieldChangeMessages(
      { LinkedGoalTemplate: { id: 'GOAL-1', title: 'Goal A', version: '1' } },
      { LinkedGoalTemplate: { id: 'GOAL-2', title: 'Goal B', version: '2' } },
    );

    expect(messages).toEqual(["'Linked goal template' was updated."]);
  });

  it('strips rules and fieldValues and reformats changes for API', () => {
    const entries: TemplateHistoryEntry[] = [
      {
        version: 1,
        templateVersionId: 'VAR-1-V01',
        status: 'draft',
        action: 'CREATED',
        title: 'Template Created',
        isActive: true,
        isLatestVersion: false,
        changes: [],
        fieldValues: { Category: { labelKey: 'Chronic Disease', value: 'CHRONIC_DISEASE' } },
        rules: { Category: { enable: true } },
      },
      {
        version: 1.1,
        templateVersionId: 'VAR-1-V01',
        status: 'draft',
        action: 'UPDATED',
        title: 'Template Updated',
        isActive: true,
        isLatestVersion: true,
        changes: [
          'Category: {"labelKey":"Chronic Disease"} → {"labelKey":"Wellness"}',
        ],
        fieldValues: { Category: { labelKey: 'Wellness', value: 'WELLNESS' } },
        rules: { Category: { enable: false } },
      },
    ];

    const api = formatHistoryEntriesForApi(entries);
    expect(api[0].rules).toBeUndefined();
    expect(api[0].fieldValues).toBeUndefined();
    expect(api[0].changes).toEqual([
      'Version updated from v1 to v1.1.',
      "'Category' changed from Chronic Disease to Wellness.",
    ]);
  });
});
