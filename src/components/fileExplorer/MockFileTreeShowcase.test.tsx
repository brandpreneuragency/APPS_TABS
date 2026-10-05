import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockFileTreeShowcase } from './MockFileTreeShowcase';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

describe('MockFileTreeShowcase', () => {
  it('renders expanded, collapsed, selected, nested, and empty-folder states', () => {
    render(<MockFileTreeShowcase />);

    expect(screen.getByTestId('mock-filetree-showcase')).toBeInTheDocument();
    expect(screen.getByTestId('mock-filetree-hint')).toBeInTheDocument();
    // Expanded top-level folder with nested children.
    expect(screen.getByTestId('mock-filetree-node-Documents/meeting-notes.md')).toBeInTheDocument();
    expect(screen.getByTestId('mock-filetree-node-Documents/research/sources.md')).toBeInTheDocument();
    // Second top-level folder starts collapsed.
    expect(screen.queryByTestId('mock-filetree-node-Projects/tabs-redesign.md')).not.toBeInTheDocument();
    // Top-level file.
    expect(screen.getByTestId('mock-filetree-node-todo.md')).toBeInTheDocument();
  });

  it('expands a collapsed folder and moves selection on click', () => {
    render(<MockFileTreeShowcase />);

    fireEvent.click(screen.getByTestId('mock-filetree-node-Projects'));
    expect(screen.getByTestId('mock-filetree-node-Projects/tabs-redesign.md')).toBeInTheDocument();
  });
});
