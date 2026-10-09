# @requimeet/server

Backend NestJS de RequiMeet (API REST en `/api`, puerto 3000).

## Desarrollo

```bash
npm install                 # desde la raiz del repo (workspaces)
npm run prisma:generate -w apps/server
npm run dev -w apps/server  # tsc --watch; arrancar con npm run start -w apps/server
```

Variables en `apps/server/.env` (ver `.env.example`). Migraciones:

```bash
npm run prisma:migrate -w apps/server   # desarrollo (crea/aplica)
npm run prisma:deploy -w apps/server    # aplica existentes
```

## Tests

```bash
npm test -w apps/server
```

Corre tests unitarios y de integracion. Los de integracion usan la base
PostgreSQL `requimeet_test` (URL fija en `src/test-utils/test-db.ts`,
`postgresql://requimeet:requimeet@localhost:55440/requimeet_test`) y limpian
las tablas entre tests. Prepararla una vez con:

```bash
DATABASE_URL=postgresql://requimeet:requimeet@localhost:55440/requimeet_test \
  npx prisma migrate deploy --schema apps/server/prisma/schema.prisma
```

Jest corre con `maxWorkers: 1` porque las suites de integracion comparten la
base de pruebas.
