/**
 * Shared wiring for domain services.
 */
export abstract class BaseService<T> {
  protected readonly repo: T;

  constructor(repo: T) {
    this.repo = repo;
  }
}
