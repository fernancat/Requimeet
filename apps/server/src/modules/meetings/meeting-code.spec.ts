import { generateMeetingCode } from './meeting-code';

describe('generateMeetingCode', () => {
  it('genera codigos de 10 caracteres sin ambiguos', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateMeetingCode();
      expect(code).toHaveLength(10);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
      expect(code).not.toMatch(/[01OLI]/);
    }
  });

  it('genera codigos variados', () => {
    const codes = new Set(
      Array.from({ length: 100 }, () => generateMeetingCode()),
    );
    expect(codes.size).toBeGreaterThan(95);
  });
});
