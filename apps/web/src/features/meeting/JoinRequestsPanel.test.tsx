import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { JoinRequestDto } from '@requimeet/contracts';
import JoinRequestsPanel from './JoinRequestsPanel';

const req = (id: string): JoinRequestDto => ({
  id,
  displayName: `Guest ${id}`,
  status: 'pending',
  createdAt: '2026-01-01T00:00:00Z',
});

describe('JoinRequestsPanel', () => {
  it('renderiza solicitudes pendientes con acciones', () => {
    const decide = vi.fn();
    render(
      <JoinRequestsPanel pending={[req('r1'), req('r2')]} rowStates={{}} decide={decide} />,
    );
    expect(screen.getByText('Guest r1')).toBeTruthy();
    expect(screen.getByText('Guest r2')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Admitir' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Rechazar' })).toHaveLength(2);
  });

  it('fila en working deshabilita sus botones', () => {
    render(
      <JoinRequestsPanel pending={[req('r1')]} rowStates={{ r1: 'working' }} decide={vi.fn()} />,
    );
    expect((screen.getByRole('button', { name: 'Admitir' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Rechazar' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sin pendientes muestra mensaje vacio', () => {
    render(<JoinRequestsPanel pending={[]} rowStates={{}} decide={vi.fn()} />);
    expect(screen.getByText('No hay solicitudes pendientes.')).toBeTruthy();
  });
});
