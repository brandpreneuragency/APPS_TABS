import { describe, expect, it } from 'vitest';
import { decodeReply } from './model';

const row = { table: 'tasks', id: 't', revision: 2, value: { id: 't', content: 'attachment' } };
const wire = {
  outcome: 'applied', applied: [{ table: 'tasks', id: 't', revision: 2, valueFromSnapshot: true }],
  snapshot: { schema: 1, initialized: true, databaseId: 'fixture', generation: 2, records: [row] },
};

describe('compact task receipt validation', () => {
  it('reuses an exact revision and preserves older complete receipts on retry', () => {
    expect(decodeReply(wire).applied).toEqual([row]);
    const old = { ...row, revision: 1, value: { id: 't', content: 'earlier attachment' } };
    expect(decodeReply({ ...wire, applied: [old] }).applied).toEqual([old]);
  });
  it('refuses a missing, newer, or ambiguous value instead of acknowledging it', () => {
    expect(() => decodeReply({ ...wire, snapshot: { ...wire.snapshot, records: [] } })).toThrow();
    expect(() => decodeReply({ ...wire, applied: [{ ...wire.applied[0], revision: 1 }] })).toThrow();
    expect(() => decodeReply({ ...wire, applied: [{ ...wire.applied[0], value: row.value }] })).toThrow();
    expect(() => decodeReply({ ...wire, applied: undefined })).toThrow();
  });
});
