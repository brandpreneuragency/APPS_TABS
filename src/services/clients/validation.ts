import type {
  ClientRecordResult,
  ContactDraftValue,
  NoteDraftValue,
  ProfileDraftValue,
} from '../../types/clients';

export function validateContact(_value: unknown): ClientRecordResult<ContactDraftValue> {
  const input = asRecord(_value);
  if (!input) return invalid('contact');

  const name = trimmedString(input.name);
  const role = trimmedString(input.role);
  const rawEmail = input.email;
  const email = trimmedString(rawEmail);
  const phone = trimmedString(input.phone);
  if (name === null || !name || name.length > 200) return invalid('name');
  if (role === null || role.length > 200) return invalid('role');
  if (email === null || email.length > 320
    || (typeof rawEmail === 'string' && /[\r\n]/.test(rawEmail))
    || !isValidEmail(email)) return invalid('email');
  if (phone === null || phone.length > 80) return invalid('phone');

  return { ok: true, value: { name, role, email, phone } };
}

export function validateProfile(_value: unknown): ClientRecordResult<ProfileDraftValue> {
  const input = asRecord(_value);
  if (!input) return invalid('profile');

  const website = trimmedString(input.website);
  const description = trimmedString(input.description);
  if (website === null || !isValidWebsite(website)) return invalid('website');
  if (description === null || description.length > 10_000) return invalid('description');

  return { ok: true, value: { website, description } };
}

export function validateNote(_value: unknown): ClientRecordResult<NoteDraftValue> {
  const input = asRecord(_value);
  if (!input) return invalid('note');

  const title = trimmedString(input.title);
  const bodyText = trimmedString(input.bodyText);
  const { kind, occurredAt, contactId } = input;
  if (title === null || title.length > 200) return invalid('title');
  if (bodyText === null || bodyText.length > 100_000) return invalid('bodyText');
  if (!title && !bodyText) return invalid('bodyText');
  if (kind !== 'call' && kind !== 'meeting' && kind !== 'decision' && kind !== 'note') {
    return invalid('kind');
  }
  if (typeof occurredAt !== 'number' || !Number.isFinite(occurredAt) || occurredAt < 0) {
    return invalid('occurredAt');
  }
  if (contactId !== null && (typeof contactId !== 'string' || contactId.length === 0)) {
    return invalid('contactId');
  }

  return { ok: true, value: { title, bodyText, kind, occurredAt, contactId } };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function isValidEmail(email: string): boolean {
  if (!email) return true;
  const at = email.indexOf('@');
  return at > 0
    && at === email.lastIndexOf('@')
    && at < email.length - 1
    && !/\s/.test(email);
}

function isValidWebsite(website: string): boolean {
  if (!website) return true;
  try {
    const url = new URL(website);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

function invalid(field: string): ClientRecordResult<never> {
  return { ok: false, code: 'VALIDATION', field };
}
