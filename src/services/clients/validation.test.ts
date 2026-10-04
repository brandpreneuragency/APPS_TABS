import { describe, expect, it } from 'vitest';
import { validateContact, validateNote, validateProfile } from './validation';

const contactValue = (overrides: Partial<{
  name: string;
  role: string;
  email: string;
  phone: string;
}> = {}) => ({ name: ' Ada Lovelace ', role: ' Analyst ', email: '', phone: ' 555 ', ...overrides });

const profileValue = (overrides: Partial<{ website: string; description: string }> = {}) => ({
  website: '', description: '', ...overrides,
});

const noteValue = (overrides: Partial<{
  title: string;
  bodyText: string;
  kind: string;
  occurredAt: number;
  contactId: string | null;
}> = {}) => ({
  title: ' Follow-up ', bodyText: ' Call again ', kind: 'call' as const,
  occurredAt: 1_759_392_000_000, contactId: null, ...overrides,
});

describe('client contact validation', () => {
  it('trims values and accepts international names', () => {
    expect(validateContact(contactValue({ name: '  Çağla 李  ' }))).toEqual({
      ok: true,
      value: { name: 'Çağla 李', role: 'Analyst', email: '', phone: '555' },
    });
  });

  it('rejects an empty trimmed name and enforces field limits', () => {
    expect(validateContact(contactValue({ name: ' \t ' }))).toEqual({
      ok: false, code: 'VALIDATION', field: 'name',
    });
    expect(validateContact(contactValue({ name: 'a'.repeat(201) }))).toMatchObject({
      ok: false, code: 'VALIDATION', field: 'name',
    });
    expect(validateContact(contactValue({ role: 'r'.repeat(201) }))).toMatchObject({
      ok: false, code: 'VALIDATION', field: 'role',
    });
    expect(validateContact(contactValue({ phone: 'p'.repeat(81) }))).toMatchObject({
      ok: false, code: 'VALIDATION', field: 'phone',
    });
  });

  it('allows an empty email and a valid exact address without rewriting it', () => {
    expect(validateContact(contactValue({ email: '  ' }))).toMatchObject({
      ok: true, value: { email: '' },
    });
    expect(validateContact(contactValue({ email: '  First.Last+tag@sub.example.test  ' }))).toMatchObject({
      ok: true, value: { email: 'First.Last+tag@sub.example.test' },
    });
  });

  it('rejects malformed email without provider-specific normalization', () => {
    for (const email of ['@example.test', 'person@', 'a@@example.test', 'first last@example.test', 'a@b\n']) {
      expect(validateContact(contactValue({ email }))).toMatchObject({
        ok: false, code: 'VALIDATION', field: 'email',
      });
    }
    expect(validateContact(contactValue({ email: `${'a'.repeat(314)}@b.test` }))).toMatchObject({
      ok: false, code: 'VALIDATION', field: 'email',
    });
  });
});

describe('client profile validation', () => {
  it('accepts blank, HTTP and HTTPS websites and trims without canonicalizing', () => {
    expect(validateProfile(profileValue({ website: '   ' }))).toMatchObject({
      ok: true, value: { website: '' },
    });
    expect(validateProfile(profileValue({ website: '  http://example.test/path  ' }))).toMatchObject({
      ok: true, value: { website: 'http://example.test/path' },
    });
    expect(validateProfile(profileValue({ website: 'https://example.test' }))).toMatchObject({
      ok: true, value: { website: 'https://example.test' },
    });
  });

  it('rejects non-web protocols, malformed URLs and credentials', () => {
    for (const website of [
      'javascript:alert(1)', 'file:///tmp/secret', 'data:text/plain,hello',
      'ftp://example.test', 'https://user:pass@example.test', 'https://',
    ]) {
      expect(validateProfile(profileValue({ website }))).toMatchObject({
        ok: false, code: 'VALIDATION', field: 'website',
      });
    }
  });

  it('trims the description and enforces its maximum length', () => {
    expect(validateProfile(profileValue({ description: '  Local partner  ' }))).toMatchObject({
      ok: true, value: { description: 'Local partner' },
    });
    expect(validateProfile(profileValue({ description: 'd'.repeat(10_001) }))).toMatchObject({
      ok: false, code: 'VALIDATION', field: 'description',
    });
  });
});

describe('client note validation', () => {
  it('trims text and accepts a finite nonnegative epoch timestamp', () => {
    expect(validateNote(noteValue())).toEqual({
      ok: true,
      value: {
        title: 'Follow-up', bodyText: 'Call again', kind: 'call',
        occurredAt: 1_759_392_000_000, contactId: null,
      },
    });
    expect(validateNote(noteValue({ title: '', bodyText: '  Keep this note  ' }))).toMatchObject({
      ok: true, value: { title: '', bodyText: 'Keep this note' },
    });
  });

  it('rejects a note whose title and body are both whitespace', () => {
    expect(validateNote(noteValue({ title: ' \n ', bodyText: '\t ' }))).toMatchObject({
      ok: false, code: 'VALIDATION', field: 'bodyText',
    });
  });

  it('requires a null or nonempty contact ID without normalizing valid IDs', () => {
    expect(validateNote(noteValue({ contactId: '' }))).toEqual({
      ok: false, code: 'VALIDATION', field: 'contactId',
    });
    expect(validateNote(noteValue({ contactId: null }))).toMatchObject({
      ok: true, value: { contactId: null },
    });
    expect(validateNote(noteValue({ contactId: 'contact-sentinel' }))).toMatchObject({
      ok: true, value: { contactId: 'contact-sentinel' },
    });

    for (const contactId of [42, true, {}, []]) {
      expect(validateNote({ ...noteValue(), contactId })).toEqual({
        ok: false, code: 'VALIDATION', field: 'contactId',
      });
    }
  });

  it('rejects invalid timestamps, note kinds and oversized text', () => {
    for (const occurredAt of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateNote(noteValue({ occurredAt }))).toMatchObject({
        ok: false, code: 'VALIDATION', field: 'occurredAt',
      });
    }
    expect(validateNote(noteValue({ kind: 'email' }))).toMatchObject({
      ok: false, code: 'VALIDATION', field: 'kind',
    });
    expect(validateNote(noteValue({ title: 't'.repeat(201) }))).toMatchObject({
      ok: false, code: 'VALIDATION', field: 'title',
    });
    expect(validateNote(noteValue({ bodyText: 'b'.repeat(100_001) }))).toMatchObject({
      ok: false, code: 'VALIDATION', field: 'bodyText',
    });
  });
});
