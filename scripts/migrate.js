import { getDatabase, migrateDatabase, closeDatabases } from '../server/database.js';
import { initializeData } from '../server/handler.js';
try {
  const db = await getDatabase(process.env);
  await migrateDatabase(db);
  await initializeData(db);
  console.log('Schema ready. Initial personas seeded only if never initialized; existing edits preserved.');
} finally { await closeDatabases(); }
