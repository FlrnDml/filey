import { defineConfig } from 'drizzle-kit';

/** Used by `npm run db:generate` (development only): turns schema changes into SQL migrations in `drizzle/`. */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/core/db/schema.ts',
  out: './drizzle',
});
