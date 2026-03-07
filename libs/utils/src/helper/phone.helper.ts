export class PhoneHelper {

    static clean(phone?: string): string | undefined {
      if (!phone) return undefined;
  
      return String(phone)
        .replace(/[^\d+]/g, "")
        .trim();
    }
  
    static normalizeCountryCode(code?: string): string | undefined {
      if (!code) return undefined;
  
      const trimmed = String(code).trim();
  
      if (!trimmed) return undefined;
  
      return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
    }
  
    static processPhoneNumber(phone?: string): string | undefined {
      if (!phone) return undefined;
  
      const cleaned = this.clean(phone);
  
      if (!cleaned) return undefined;
  
      return cleaned;
    }
  
    static buildE164(phone?: string, phoneCode?: string): string | undefined {
  
      const number = this.processPhoneNumber(phone);
      const code = this.normalizeCountryCode(phoneCode);
  
      if (!number) return undefined;
  
      if (number.startsWith("+")) {
        return number;
      }
  
      if (code) {
        return `${code}${number}`;
      }
  
      return `+${number}`;
    }
  
    static validateE164(phone?: string): boolean {
      if (!phone) return false;
  
      const regex = /^\+[1-9]\d{6,14}$/;
  
      return regex.test(phone);
    }
  
    static maskPhone(phone?: string): string | undefined {
  
      if (!phone) return undefined;
  
      const cleaned = this.clean(phone);
  
      if (!cleaned) return undefined;
  
      if (cleaned.length <= 4) return cleaned;
  
      const visible = cleaned.slice(-4);
  
      return `******${visible}`;
    }
  
    static buildNotifyPhone(
      user: { phoneNumber?: string; phoneCode?: string },
      contact?: { phone?: string; phoneCode?: string }
    ): string | undefined {
  
      const phone =
        user?.phoneNumber ||
        contact?.phone;
  
      const code =
        user?.phoneCode ||
        contact?.phoneCode;
  
      return this.buildE164(phone, code);
    }
  
  }