import { AlertRepository } from './repositories/alert-repository';

describe('AlertRepository', () => {
  it('exports constructible repository', () => {
    expect(new AlertRepository()).toBeInstanceOf(AlertRepository);
  });
});
