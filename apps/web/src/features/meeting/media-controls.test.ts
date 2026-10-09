import { describe, expect, it } from 'vitest';
import { screenShareBlockReason } from './media-controls';

describe('screenShareBlockReason', () => {
  it('bloquea si otro participante presenta, con su nombre', () => {
    const reason = screenShareBlockReason([
      { identity: 'p2', name: 'Ana', isLocal: false },
    ]);
    expect(reason).toBe('Ana está presentando; espera a que termine');
  });

  it('permite si nadie presenta o solo el local', () => {
    expect(screenShareBlockReason([])).toBeNull();
    expect(
      screenShareBlockReason([{ identity: 'p1', name: 'Yo', isLocal: true }]),
    ).toBeNull();
  });

  it('sin nombre usa etiqueta generica', () => {
    const reason = screenShareBlockReason([{ identity: 'p2', name: '', isLocal: false }]);
    expect(reason).toContain('está presentando');
  });
});
