import 'reflect-metadata';
import { CryptoService } from '../config/crypto.service';
import { DatabaseService } from './database.service';

async function main() {
  const crypto = new CryptoService();
  const db = new DatabaseService(crypto);
  await db.onModuleInit();
  console.log('[NEXORA DB] All PostgreSQL migrations applied successfully.');
  await db.onModuleDestroy();
}

main().catch((err) => {
  console.error('[NEXORA DB] Migration failed:', err);
  process.exit(1);
});
