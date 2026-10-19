import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { crmFormsDb } from '../data/crmFormsDb';
import { listDeals, setDealStage } from './crmService';
import { sortKanbanCards } from './kanbanOrder';
import type { CRMDeal } from '../types/crm';

describe('CRM kanban placement', () => {
  beforeEach(async () => {
    await crmFormsDb.delete();
    await crmFormsDb.open();
    const deals: CRMDeal[] = ['a', 'b', 'c'].map((id) => ({
      id, title: id, stage: id === 'c' ? 'contacted' : 'new', tags: [],
      createdAt: '2026-10-18', updatedAt: '2026-10-18',
    }));
    await crmFormsDb.crmDeals.bulkAdd(deals);
  });

  it('persists insertion between legacy deals without an order and same-stage reordering', async () => {
    await setDealStage('c', 'new', 'b');
    expect(sortKanbanCards(await listDeals()).map((deal) => deal.id)).toEqual(['a', 'c', 'b']);
    await setDealStage('b', 'new', 'a');
    expect(sortKanbanCards(await listDeals()).map((deal) => deal.id)).toEqual(['b', 'a', 'c']);
    expect(await crmFormsDb.crmActivities.where('type').equals('deal_stage_changed').count()).toBe(1);
  });

  it('appends to empty columns without altering other stages', async () => {
    const before = await crmFormsDb.crmDeals.get('a');
    await setDealStage('c', 'qualified', null);
    expect(await crmFormsDb.crmDeals.get('c')).toMatchObject({ stage: 'qualified', order: 0 });
    expect(await crmFormsDb.crmDeals.get('a')).toEqual(before);
  });
});
