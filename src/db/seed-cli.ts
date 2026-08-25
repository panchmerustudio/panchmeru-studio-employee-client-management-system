/**
 * CLI entry point for seeding — run with: npm run db:seed
 * (kept separate from seed.ts so seedDatabase() can also be imported and
 * called from src/app/api/setup/seed/route.ts without auto-running).
 */
import { seedDatabase } from "./seed";

seedDatabase()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
