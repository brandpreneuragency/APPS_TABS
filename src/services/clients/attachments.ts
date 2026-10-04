import { saveAs } from 'file-saver';
import type { ClientAttachment, ClientRecordResult } from '../../types/clients';

export function sanitizeAttachmentFilename(value: string): string {
  const basename = value.split(/[\\/]/).pop() ?? '';
  const cleaned = Array.from(basename)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    })
    .join('')
    .trim();
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'attachment';
}

export async function exportClientAttachment(
  attachment: ClientAttachment,
): Promise<ClientRecordResult<void>> {
  try {
    saveAs(attachment.data, sanitizeAttachmentFilename(attachment.displayName));
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, code: 'STORAGE' };
  }
}
