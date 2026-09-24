import { beforeEach, expect, it, vi } from 'vitest';
import { useProjectStore } from './projectStore';

const { update, showToast } = vi.hoisted(() => ({ update: vi.fn(), showToast: vi.fn() }));
vi.mock('../services/db', () => ({ db: { projects: { update } } }));
vi.mock('./clientStore', () => ({ useClientStore: { getState: () => ({ clients: [{ id: 'c1' }, { id: 'c2' }] }) } }));
vi.mock('./taskStore', () => ({ useTaskStore: { getState: vi.fn() } }));
vi.mock('./uiStore', () => ({ useUIStore: { getState: () => ({ showToast }) } }));

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue(1);
  useProjectStore.setState({ projects: [
    { id: 'p1', name: 'Website', clientId: 'c1', color: 'blue', createdAt: 1, order: 0 },
  ] });
});

it('persists client reassignment without changing project identity', async () => {
  await useProjectStore.getState().updateProject('p1', { clientId: 'c2' });
  expect(update).toHaveBeenCalledWith('p1', { clientId: 'c2' });
  expect(useProjectStore.getState().projects[0]).toMatchObject({ id: 'p1', clientId: 'c2' });
});

it('rejects a nonexistent client', async () => {
  await useProjectStore.getState().updateProject('p1', { clientId: 'missing' });
  expect(update).not.toHaveBeenCalled();
  expect(useProjectStore.getState().projects[0].clientId).toBe('c1');
});

it('rejects duplicate names in the destination client', async () => {
  useProjectStore.setState((state) => ({ projects: [...state.projects, { ...state.projects[0], id: 'p2', clientId: 'c2' }] }));
  await useProjectStore.getState().updateProject('p1', { clientId: 'c2' });
  expect(update).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalled();
  expect(useProjectStore.getState().projects[0].clientId).toBe('c1');
});

it('restores the original client if persistence fails', async () => {
  update.mockRejectedValueOnce(new Error('Write failed'));
  await useProjectStore.getState().updateProject('p1', { clientId: 'c2' });
  expect(useProjectStore.getState().projects[0].clientId).toBe('c1');
  expect(showToast).toHaveBeenCalledWith('Write failed', 'error');
});
