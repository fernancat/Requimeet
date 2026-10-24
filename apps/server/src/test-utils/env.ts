// Prisma also loads .env when imported: pin test configuration before any imports.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://requimeet:requimeet@localhost:55440/requimeet_test',
  LIVEKIT_URL: 'ws://127.0.0.1:9',
  LIVEKIT_API_KEY: '',
  LIVEKIT_API_SECRET: '',
  PROCESSOR_INTERNAL_URL: 'http://127.0.0.1:9',
  INTERNAL_SHARED_SECRET: '',
  OPENROUTER_API_KEY: '',
  DEEPGRAM_API_KEY: '',
});
