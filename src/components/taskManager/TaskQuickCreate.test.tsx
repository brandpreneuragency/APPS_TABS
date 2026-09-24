import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskQuickCreate } from './TaskQuickCreate';

const createTask = vi.fn();
const showToast = vi.fn();

const clients = [
  { id: 'c1', name: 'Brandpreneur', color: 'c1', createdAt: 0, order: 0 },
  { id: 'c2', name: 'Acme', color: 'c2', createdAt: 0, order: 1 },
];

const projects = [
  { id: 'p-gen', name: 'General', color: 'c1', clientId: 'c1', createdAt: 0, order: 0 },
  { id: 'p-web', name: 'Website', color: 'c1b', clientId: 'c1', createdAt: 0, order: 1 },
  { id: 'p-other', name: 'Other', color: 'c2', clientId: 'c2', createdAt: 0, order: 0 },
];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../stores/clientStore', () => ({
  useClientStore: (selector?: (s: { clients: typeof clients }) => unknown) => {
    const state = { clients };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: (selector?: (s: { projects: typeof projects }) => unknown) => {
    const state = { projects };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../stores/taskStore', () => ({
  useTaskStore: (selector?: (s: { createTask: typeof createTask }) => unknown) => {
    const state = { createTask };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: (selector: (s: { showToast: typeof showToast }) => unknown) =>
    selector({ showToast }),
}));

describe('TaskQuickCreate', () => {
  beforeEach(() => {
    createTask.mockReset();
    showToast.mockReset();
    createTask.mockResolvedValue({ id: 't-new' });
  });

  it('opens a themed client dropup instead of a native select', async () => {
    const user = userEvent.setup();
    render(<TaskQuickCreate />);

    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    const trigger = screen.getByRole('button', { name: 'tasks.selectClient' });
    expect(trigger).toHaveClass('task-quick-create-select');

    await user.click(trigger);

    const menu = screen.getByRole('menu', { name: 'tasks.selectClient' });
    expect(menu).toHaveClass('drop');
    expect(menu).toHaveClass('task-quick-create-menu');
    expect(document.body.contains(menu)).toBe(true);
    expect(within(menu).getByRole('menuitem', { name: 'Brandpreneur' })).toHaveClass('drop-item');
    expect(within(menu).getByRole('menuitem', { name: 'Acme' })).toHaveClass('drop-item');
  });

  it('filters projects after a client is chosen from the themed menu', async () => {
    const user = userEvent.setup();
    render(<TaskQuickCreate />);

    await user.click(screen.getByRole('button', { name: 'tasks.selectClient' }));
    await user.click(screen.getByRole('menuitem', { name: 'Acme' }));

    expect(screen.getByRole('button', { name: 'tasks.selectClient' })).toHaveTextContent('Acme');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'tasks.selectProject' }));
    const menu = screen.getByRole('menu', { name: 'tasks.selectProject' });
    expect(within(menu).getByRole('menuitem', { name: 'Other' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'General' })).not.toBeInTheDocument();
  });

  it('creates a task with the chosen project and does not close the form from a menu click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TaskQuickCreate date="2026-09-21" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'tasks.selectProject' }));
    await user.click(screen.getByRole('menuitem', { name: 'Website' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox'), 'Ship site');
    await user.click(screen.getByRole('button', { name: 'tasks.createTask' }));

    expect(createTask).toHaveBeenCalledWith(
      'Ship site',
      expect.objectContaining({ projectId: 'p-web', date: '2026-09-21' }),
    );
  });

  it('closes only the open dropup on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TaskQuickCreate onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'tasks.selectClient' }));
    expect(screen.getByRole('menu', { name: 'tasks.selectClient' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
