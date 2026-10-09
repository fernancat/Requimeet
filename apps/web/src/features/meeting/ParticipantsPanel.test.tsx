import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParticipantDto } from '@requimeet/contracts';
import ParticipantsPanel from './ParticipantsPanel';

const participants: ParticipantDto[] = [
  {
    id: 'p-self',
    displayName: 'Host',
    role: 'host',
    state: 'admitted',
    joinedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'p-guest',
    displayName: 'Ana',
    role: 'participant',
    state: 'admitted',
    joinedAt: '2026-01-01T00:00:01Z',
  },
];

function renderPanel(overrides: Partial<Parameters<typeof ParticipantsPanel>[0]> = {}) {
  const props: Parameters<typeof ParticipantsPanel>[0] = {
    participants,
    selfParticipantId: 'p-self',
    micState: { 'p-guest': true },
    sharingIdentities: new Set(),
    onSwitchDevice: vi.fn().mockResolvedValue(undefined),
    devices: [],
    isHost: true,
    hostActions: {
      mute: vi.fn().mockResolvedValue(undefined),
      kick: vi.fn().mockResolvedValue(undefined),
      errors: {},
    },
    ...overrides,
  };
  return { props, ...render(<ParticipantsPanel {...props} />) };
}

describe('ParticipantsPanel (controles host)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no muestra acciones sobre si mismo', () => {
    renderPanel();
    const selfRow = screen.getByText(/Host/).closest('li')!;
    expect(selfRow.textContent).not.toContain('Silenciar');
    expect(selfRow.textContent).not.toContain('Expulsar');
    const guestRow = screen.getByText('Ana').closest('li')!;
    expect(guestRow.textContent).toContain('Silenciar');
    expect(guestRow.textContent).toContain('Expulsar');
  });

  it('expulsar pide confirmacion y luego llama a kick', async () => {
    const { props } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Expulsar' }));
    expect(props.hostActions!.kick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar expulsión' }));
    await waitFor(() => {
      expect(props.hostActions!.kick).toHaveBeenCalledWith('p-guest');
    });
  });

  it('silenciar llama a mute', async () => {
    const { props } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Silenciar' }));
    await waitFor(() => {
      expect(props.hostActions!.mute).toHaveBeenCalledWith('p-guest');
    });
  });

  it('no ofrece silenciar si el mic ya esta apagado', () => {
    renderPanel({ micState: { 'p-guest': false } });
    expect(screen.queryByRole('button', { name: 'Silenciar' })).toBeNull();
  });

  it('error del backend se muestra en la fila', () => {
    renderPanel({
      hostActions: {
        mute: vi.fn(),
        kick: vi.fn(),
        errors: { 'p-guest': 'Sin permiso' },
      },
    });
    expect(screen.getByText('Sin permiso')).toBeTruthy();
  });

  it('no-host no ve acciones de moderacion', () => {
    renderPanel({ isHost: false, hostActions: undefined });
    expect(screen.queryByRole('button', { name: 'Silenciar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Expulsar' })).toBeNull();
  });

  it('no muestra acciones sobre otro host', () => {
    const twoHosts: ParticipantDto[] = [
      ...participants,
      {
        id: 'p-other-host',
        displayName: 'OtroHost',
        role: 'host',
        state: 'admitted',
        joinedAt: '2026-01-01T00:00:02Z',
      },
    ];
    renderPanel({ participants: twoHosts });
    const row = screen.getByText('OtroHost').closest('li')!;
    expect(row.textContent).not.toContain('Expulsar');
  });
});
