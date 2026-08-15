import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/infra/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/rebecca_sellbot',
  },
});
