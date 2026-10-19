const REQUIREMENT_PATTERNS = [
  /\b(?:el sistema|la aplicación|la plataforma)\s+(?:debe|deberá|debería|tiene que)\b/iu,
  /\b(?:necesitamos|requerimos)\s+(?:que|poder|registrar|guardar|consultar|generar|permitir|validar|enviar|mostrar|crear|eliminar|editar)\b/iu,
  /\bse\s+debe(?:rá|ría)?\b/iu,
  /\b(?:el usuario|el administrador|los usuarios)\s+(?:debe|deberá|debería|tiene que)\b/iu,
  /\b(?:solo|solamente|únicamente)\b.+\b(?:puede|podrá|debe|deberá)\b/iu,
  /\bno\s+(?:se\s+)?debe(?:rá|ría)?\b/iu,
];

export function extractRequirementCandidates(text: string): string[] {
  const sentences = text
    .split(/[.!?;\n]+/u)
    .map((sentence) => sentence.replace(/\s+/gu, ' ').trim())
    .filter(Boolean);

  const candidates = new Map<string, string>();

  for (const sentence of sentences) {
    const matches = REQUIREMENT_PATTERNS.some((pattern) =>
      pattern.test(sentence),
    );

    if (!matches) {
      continue;
    }

    const key = sentence.toLocaleLowerCase('es');

    if (!candidates.has(key)) {
      candidates.set(key, sentence);
    }
  }

  return [...candidates.values()];
}