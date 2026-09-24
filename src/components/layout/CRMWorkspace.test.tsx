import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CRMWorkspace } from './CRMWorkspace';

vi.mock('../../stores/uiStore', () => ({
  useUIStore: () => ({ activeCRMPage: 'projects' }),
}));
vi.mock('../taskManager/TaskProjectsKanban', () => ({
  TaskProjectsKanban: () => <div>Existing projects board</div>,
}));

it('renders the existing projects board on the Projects route', () => {
  render(<CRMWorkspace />);
  expect(screen.getByText('Existing projects board')).toBeInTheDocument();
});
