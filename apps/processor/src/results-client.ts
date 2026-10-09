import type { ProcessingResult } from '@requimeet/contracts';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [250, 1000];

/** POST de resultados al backend; los fallos se loguean y se descartan. */
export class ResultsClient {
  constructor(
    private readonly serverInternalUrl: string,
    private readonly internalSecret: string,
    private readonly logger: (msg: string) => void = () => {},
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  async post(result: ProcessingResult): Promise<void> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await this.doFetch(
          `${this.serverInternalUrl}/api/internal/processing/results`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-internal-secret': this.internalSecret,
            },
            body: JSON.stringify(result),
          },
        );
        if (res.ok) return;
        this.logger(`result ${result.resultId}: backend respondio ${res.status}`);
      } catch (error) {
        this.logger(`result ${result.resultId}: error de red (${String(error)})`);
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
      }
    }
    this.logger(`result ${result.resultId}: descartado tras ${MAX_ATTEMPTS} intentos`);
  }
}
