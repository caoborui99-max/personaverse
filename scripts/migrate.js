import { getDatabase, migrateDatabase, closeDatabases } from '../server/database.js';
import { initializeData } from '../server/handler.js';
// Explicit CLI guard; never log database URLs or credential values.
if ((process.env.NODE_ENV === 'production' || process.env.VERCEL) && !process.argv.includes('--confirm-production')) {
  throw new Error('Production migration requires an explicit --confirm-production argument after backup and target verification.');
}
try {
  const db = await getDatabase(process.env);
  await migrateDatabase(db);
  await initializeData(db);
  console.log('Schema ready. Initial personas seeded only if never initialized; existing edits preserved.');
} finally { await closeDatabases(); }

