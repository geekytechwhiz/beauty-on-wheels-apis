import type { AdapterConstructor } from './adapter.interface';
import { RedcliffeAdapter } from '../redcliffe/redcliffe.adapter';
import { OrangeAdapter } from '../orange/orange.adapter';

/**
 * Registry mapping adapter keys to their constructors.
 * To add a new partner:
 * 1. Implement PartnerAdapter interface
 * 2. Add entry to this registry
 * 3. No changes needed to factory or other code
 */
class AdapterRegistry {
  private registry = new Map<string, AdapterConstructor>();

  constructor() {
    this.register('redcliffe', RedcliffeAdapter);
    this.register('orange', OrangeAdapter);
    this.register('orangehealth', OrangeAdapter);
  }

  /**
   * Register a new adapter type.
   * @param key - Unique identifier for the adapter (lowercase)
   * @param constructor - Adapter class constructor
   */
  register(key: string, constructor: AdapterConstructor): void {
    this.registry.set(key.toLowerCase(), constructor);
  }

  /**
   * Get adapter constructor by key.
   * @param key - Adapter key from partner configuration
   * @throws Error if adapter not found
   */
  getConstructor(key: string): AdapterConstructor {
    const constructor = this.registry.get(key.toLowerCase());
    if (!constructor) {
      throw new Error(
        `No adapter registered for key: ${key}. ` +
          `Available adapters: ${Array.from(this.registry.keys()).join(', ')}`
      );
    }
    return constructor;
  }

  /**
   * Check if adapter is registered.
   */
  has(key: string): boolean {
    return this.registry.has(key.toLowerCase());
  }

  /**
   * Get all registered adapter keys.
   */
  getRegisteredKeys(): string[] {
    return Array.from(this.registry.keys());
  }
}

export const adapterRegistry = new AdapterRegistry();
