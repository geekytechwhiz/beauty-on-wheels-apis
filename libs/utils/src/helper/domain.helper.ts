export function normalizePhone(
    phone?: string,
    phoneCode?: string
  ): string {
  
    if (!phone) return '';
  
    const p = String(phone).trim();
    const code = String(phoneCode || '').trim();
  
    const combined = code ? `${code}${p}` : p;
  
    return combined.startsWith('+')
      ? combined
      : `+${combined}`;
  }