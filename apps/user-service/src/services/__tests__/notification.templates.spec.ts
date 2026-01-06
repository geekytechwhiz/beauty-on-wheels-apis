import { describe, it, expect } from 'vitest';
import { renderTemplate } from '@api-hub/utils';

describe('notification.templates', () => {
  it('renders welcome user correctly', () => {
    const r = renderTemplate('WELCOME_USER', { ORG_NAME: 'Acme Hospital' });
    expect(r.subject).toContain('Welcome');
    expect(r.body).toContain('Acme Hospital');
    expect(r.sms).toContain('Acme Hospital');
  });

  it('renders staff template correctly', () => {
    const r = renderTemplate('WELCOME_STAFF', { ORG_NAME: 'Acme', STAFF_FIRST_NAME: 'Alice', PORTAL_LINK: 'https://portal' });
    expect(r.subject).toContain('Alice');
    expect(r.body).toContain('https://portal');
  });
});
