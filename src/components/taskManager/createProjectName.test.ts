import { describe, expect, it } from 'vitest';
import { resolveCreateProjectName } from './createProjectName';

describe('resolveCreateProjectName', () => {
  it('rejects blank and whitespace-only names', () => {
    expect(resolveCreateProjectName('', [])).toEqual({ status: 'empty' });
    expect(resolveCreateProjectName('   ', ['General'])).toEqual({ status: 'empty' });
  });

  it('rejects an existing name case-insensitively', () => {
    expect(resolveCreateProjectName('General', ['General'])).toEqual({ status: 'duplicate' });
    expect(resolveCreateProjectName('  general  ', ['General'])).toEqual({ status: 'duplicate' });
  });

  it('accepts a unique trimmed name', () => {
    expect(resolveCreateProjectName('  Launch  ', ['General'])).toEqual({
      status: 'ok',
      name: 'Launch',
    });
  });
});
