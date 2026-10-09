import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import PreJoinPage from './PreJoinPage';

function mockMediaDevices(getUserMediaImpl: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(getUserMediaImpl),
      enumerateDevices: vi.fn().mockResolvedValue([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

describe('PreJoinPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('boton deshabilitado con nombre vacio', async () => {
    mockMediaDevices(() => Promise.reject(new DOMException('no', 'NotAllowedError')));
    render(<PreJoinPage code="ABC123" onRequested={() => {}} />);

    const button = screen.getByRole('button', { name: /solicitar ingreso/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('permisos denegados muestra mensaje comprensible', async () => {
    mockMediaDevices(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    render(<PreJoinPage code="ABC123" onRequested={() => {}} />);

    await waitFor(() => {
      expect(
        screen.getByText('Permisos denegados: habilítalos en el navegador'),
      ).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /continuar sin cámara/i })).toBeTruthy();
  });
});
