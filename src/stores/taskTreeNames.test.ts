import { describe, expect, it } from 'vitest';
import {
  isNameTaken, uniqueClientName, sanitizeFsName, taskMirrorDir, projectMirrorDir, normalizeTreeName,
} from './taskTreeNames';

describe('taskTreeNames', () => {
  it('treats names as taken case-insensitively with tr-TR', () => {
    expect(isNameTaken('GENERAL', ['General'])).toBe(true);
    expect(isNameTaken('Launch', ['General'])).toBe(false);
  });

  it('suffixes until unique', () => {
    expect(uniqueClientName('WA', ['WA'])).toBe('WA 2');
    expect(uniqueClientName('WA', ['WA', 'WA 2'])).toBe('WA 3');
  });

  it('trims and caps at 80 chars', () => {
    expect(normalizeTreeName('  ab  ')).toBe('ab');
    expect(normalizeTreeName('x'.repeat(90)).length).toBe(80);
  });

  it('builds nested TASKS paths', () => {
    expect(sanitizeFsName('Hermes / AI')).toBe('Hermes _ AI');
    expect(projectMirrorDir('Brandpreneur', 'General')).toBe('TASKS/Brandpreneur/General');
    expect(taskMirrorDir('Brandpreneur', 'General', 'abc')).toBe('TASKS/Brandpreneur/General/abc');
  });
});
