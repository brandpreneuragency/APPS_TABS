import { expect, it } from 'vitest';
import { attachmentContext, resolveScopeWorkspaceRoot } from './contextBuilder';
import { serializeDocx } from '../docxFormat';
import { bytesToDataUrl } from '../../utils/fileData';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRRkAAAAASUVORK5CYII=';

it('uses a CLI fallback without starting the Codex workspace helper', async () => {
  let codexCalled = false;
  const result = await resolveScopeWorkspaceRoot(undefined, 'C:/tabs-cli-workspace', async () => {
    codexCalled = true;
    return 'C:/tabs-codex-workspace';
  });
  expect(result).toBe('C:/tabs-cli-workspace');
  expect(codexCalled).toBe(false);
});

it('keeps a supported image in native input context and rejects unsupported formats', async () => {
  expect(await attachmentContext([{ kind: 'image', name: 'pixel.png', mimeType: 'image/png', dataUrl: png }], 'C:/synthetic'))
    .toEqual(['[IMAGE ATTACHMENT: pixel.png]']);
  await expect(attachmentContext([{ kind: 'image', name: 'vector.svg', mimeType: 'image/svg+xml',
    dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }], 'C:/synthetic')).rejects.toThrow('unsupported image format');
});

it('extracts picked DOCX text for a bounded Codex turn', async () => {
  const bytes = await serializeDocx({ type: 'doc', content: [{ type: 'paragraph',
    content: [{ type: 'text', text: 'Synthetic meeting notes' }] }] });
  const result = await attachmentContext([{ kind: 'file', name: 'notes.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    dataUrl: bytesToDataUrl(bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') }],
  'C:/synthetic');
  expect(result[0]).toContain('Synthetic meeting notes');
});
