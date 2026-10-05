import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CRMWorkspace } from './CRMWorkspace';

const crmPageState = vi.hoisted(() => ({ page: 'projects' }));

vi.mock('../../stores/uiStore', () => ({
  useUIStore: () => ({ activeCRMPage: crmPageState.page }),
}));
vi.mock('../taskManager/TaskProjectsKanban', () => ({
  TaskProjectsKanban: () => <div>Existing projects board</div>,
}));

beforeEach(() => { crmPageState.page = 'projects'; });

it('renders the existing projects board on the Projects route', () => {
  render(<CRMWorkspace />);
  expect(screen.getByText('Existing projects board')).toBeInTheDocument();
});

it('renders the Clients workspace on the Clients route', () => {
  crmPageState.page = 'clients';
  const { container } = render(<CRMWorkspace />);
  expect(container.querySelector('.clients-workspace')).toBeInTheDocument();
});
