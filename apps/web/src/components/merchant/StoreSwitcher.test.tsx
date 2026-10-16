// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreSwitcher } from './StoreSwitcher';
import { useStoreContext } from '@/context/StoreContext';

vi.mock('@/context/StoreContext', () => ({
  useStoreContext: vi.fn(),
}));

const mockUseStoreContext = vi.mocked(useStoreContext);

describe('StoreSwitcher', () => {
  const refreshStoresMock = vi.fn().mockResolvedValue(undefined);
  const selectStoreMock = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders regular switcher when loaded without error', () => {
    mockUseStoreContext.mockReturnValue({
      stores: [
        { id: 1, merchantId: 10, address: 'G...', name: 'Main Store', createdAt: '2026-01-01' },
        {
          id: 2,
          merchantId: 10,
          address: 'G...',
          name: 'Secondary Store',
          createdAt: '2026-01-01',
        },
      ],
      activeStoreId: 1,
      loading: false,
      error: null,
      refreshStores: refreshStoresMock,
      selectStore: selectStoreMock,
    });

    render(<StoreSwitcher />);

    const select = screen.getByRole('combobox', { name: /active store/i });
    expect(select).not.toBeDisabled();
    expect(screen.getByRole('option', { name: 'Main Store' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Secondary Store' })).toBeInTheDocument();
    expect(screen.queryByText(/stores unavailable - retry/i)).not.toBeInTheDocument();
  });

  it('renders disabled degraded control with retry affordance and live-region announcement when error occurs', () => {
    mockUseStoreContext.mockReturnValue({
      stores: [
        {
          id: 1,
          merchantId: 10,
          address: 'G...',
          name: 'Downtown Branch',
          createdAt: '2026-01-01',
        },
      ],
      activeStoreId: 1,
      loading: false,
      error: 'Unable to load stores',
      refreshStores: refreshStoresMock,
      selectStore: selectStoreMock,
    });

    render(<StoreSwitcher />);

    // Renders disabled select
    const select = screen.getByRole('combobox', { name: /active store/i });
    expect(select).toBeDisabled();
    // Keeps active store readable
    expect(screen.getByText('Downtown Branch')).toBeInTheDocument();

    // Visible retry affordance
    const retryBtn = screen.getByRole('button', { name: /stores unavailable - retry/i });
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn).not.toBeDisabled();

    // Live-region status announcement exists
    const statusAnnouncements = screen.getAllByRole('status');
    const liveAnnouncement = statusAnnouncements.find(
      (el) => el.getAttribute('aria-live') === 'polite',
    );
    expect(liveAnnouncement).toBeDefined();
    expect(liveAnnouncement?.textContent).toContain('Stores unavailable - retry');

    // Clicking retry calls refreshStores()
    fireEvent.click(retryBtn);
    expect(refreshStoresMock).toHaveBeenCalledTimes(2); // once on mount + once on click
  });

  it('restores normal switcher when retry succeeds without page reload', () => {
    let contextState: {
      stores: Array<{
        id: number;
        merchantId: number;
        address: string;
        name: string;
        createdAt: string;
      }>;
      activeStoreId: number | null;
      loading: boolean;
      error: string | null;
      refreshStores: typeof refreshStoresMock;
      selectStore: typeof selectStoreMock;
    } = {
      stores: [],
      activeStoreId: null,
      loading: false,
      error: 'Failed to fetch',
      refreshStores: refreshStoresMock,
      selectStore: selectStoreMock,
    };

    mockUseStoreContext.mockImplementation(() => contextState);

    const { rerender } = render(<StoreSwitcher />);

    expect(screen.getByRole('button', { name: /stores unavailable - retry/i })).toBeInTheDocument();

    // Simulate successful recovery
    contextState = {
      stores: [
        { id: 5, merchantId: 10, address: 'G...', name: 'Flagship Store', createdAt: '2026-01-01' },
      ],
      activeStoreId: 5,
      loading: false,
      error: null,
      refreshStores: refreshStoresMock,
      selectStore: selectStoreMock,
    };

    rerender(<StoreSwitcher />);

    expect(
      screen.queryByRole('button', { name: /stores unavailable - retry/i }),
    ).not.toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: /active store/i });
    expect(select).not.toBeDisabled();
    expect(screen.getByText('Flagship Store')).toBeInTheDocument();
  });

  it('keeps active store readable when activeStoreId exists even if stores list is empty during error', () => {
    mockUseStoreContext.mockReturnValue({
      stores: [],
      activeStoreId: 42,
      loading: false,
      error: 'Network disconnected',
      refreshStores: refreshStoresMock,
      selectStore: selectStoreMock,
    });

    render(<StoreSwitcher />);

    const select = screen.getByRole('combobox', { name: /active store/i });
    expect(select).toBeDisabled();
    expect(screen.getByText('Store #42')).toBeInTheDocument();
  });

  it('does not collapse to skeleton when loading if stores list is non-empty', () => {
    mockUseStoreContext.mockReturnValue({
      stores: [
        { id: 1, merchantId: 10, address: 'G...', name: 'Main Store', createdAt: '2026-01-01' },
      ],
      activeStoreId: 1,
      loading: true,
      error: null,
      refreshStores: refreshStoresMock,
      selectStore: selectStoreMock,
    });

    const { container } = render(<StoreSwitcher />);

    expect(container.querySelector('.animate-pulse')).toBeNull();
    const select = screen.getByRole('combobox', { name: /active store/i });
    expect(select).toBeDisabled();
    expect(screen.getByText('Main Store')).toBeInTheDocument();
  });
});
