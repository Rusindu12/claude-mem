import { Injectable, Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';
import { CryptoService } from '../config/crypto.service';

export interface QueryResultRow {
  [column: string]: any;
}

export interface DbQueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DbQueryRunner {
  query<T = any>(sql: string, params?: any[]): Promise<DbQueryResult<T>>;
}

@Injectable()
export class DatabaseService implements DbQueryRunner, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pgPool: Pool | null = null;
  private pglite: PGlite | null = null;
  private driverType: 'pg' | 'pglite' = 'pglite';

  // FIFO mutex used when running single-session PGlite so concurrent transactions never interleave
  private txMutexChain: Promise<void> = Promise.resolve();

  constructor(@Inject(CryptoService) private readonly cryptoService: CryptoService) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
    await this.runMigrations();
    await this.bootstrapEnvironmentState();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
    if (this.pglite) {
      await this.pglite.close();
      this.pglite = null;
    }
  }

  getDriverType(): 'pg' | 'pglite' {
    return this.driverType;
  }

  private async connect(): Promise<void> {
    if (this.pgPool || this.pglite) return;

    const dbUrl = process.env.DATABASE_URL || 'pglite://./.pgdata-nexora';
    if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
      this.driverType = 'pg';
      this.pgPool = new Pool({
        connectionString: dbUrl,
        max: Number(process.env.DB_POOL_MAX || 25),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      });
      await this.pgPool.query('SELECT 1');
      this.logger.log('Connected to PostgreSQL cluster via pg.Pool');
    } else {
      this.driverType = 'pglite';
      const target = dbUrl.replace(/^pglite:\/\//, '');
      if (target === 'memory' || target === ':memory:') {
        this.pglite = new PGlite();
        this.logger.log('Initialized embedded PostgreSQL 16 (PGlite in-memory mode)');
      } else {
        const resolvedDir = path.resolve(process.cwd(), target);
        fs.mkdirSync(path.dirname(resolvedDir), { recursive: true });
        this.pglite = new PGlite(resolvedDir);
        await this.pglite.waitReady;
        this.logger.log(`Initialized embedded PostgreSQL 16 (PGlite disk: ${resolvedDir})`);
      }
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<DbQueryResult<T>> {
    if (this.pgPool) {
      const res = await this.pgPool.query(sql, params);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    }
    if (!this.pglite) {
      await this.connect();
    }
    // Wait for any active PGlite transaction to complete before running standalone query
    return this.enqueuePgliteOp(async () => {
      const res = await this.pglite!.query<T>(sql, params);
      const count = res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0);
      return { rows: res.rows, rowCount: count };
    });
  }

  /**
   * Executes `work` inside a strict ACID PostgreSQL transaction.
   * - On pg.Pool: uses dedicated PoolClient with BEGIN / COMMIT / ROLLBACK + row-level FOR UPDATE locks.
   * - On PGlite: serializes via FIFO mutex + PGlite.transaction (real PostgreSQL BEGIN / COMMIT / ROLLBACK).
   */
  async withTransaction<R>(work: (tx: DbQueryRunner) => Promise<R>): Promise<R> {
    if (this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        const runner: DbQueryRunner = {
          query: async <T = any>(sql: string, params: any[] = []): Promise<DbQueryResult<T>> => {
            const res = await client.query(sql, params);
            return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
          },
        };
        const result = await work(runner);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    if (!this.pglite) {
      await this.connect();
    }

    return this.enqueuePgliteOp(async () => {
      return this.pglite!.transaction(async (pgTx) => {
        const runner: DbQueryRunner = {
          query: async <T = any>(sql: string, params: any[] = []): Promise<DbQueryResult<T>> => {
            const res = await pgTx.query<T>(sql, params);
            const count = res.rows.length > 0 ? res.rows.length : (res.affectedRows ?? 0);
            return { rows: res.rows, rowCount: count };
          },
        };
        return work(runner);
      });
    });
  }

  private enqueuePgliteOp<R>(fn: () => Promise<R>): Promise<R> {
    const run = this.txMutexChain.then(fn, fn);
    this.txMutexChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async runMigrations(): Promise<void> {
    await this.execMultiStatement(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(180) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const candidates = [
      path.resolve(__dirname, '../../../database/migrations'),
      path.resolve(process.cwd(), '../database/migrations'),
      path.resolve(process.cwd(), 'database/migrations'),
    ];
    const migrationsDir = candidates.find((d) => fs.existsSync(d));
    if (!migrationsDir) {
      throw new Error(`Database migrations directory not found. Checked: ${candidates.join(', ')}`);
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const existing = await this.query<{ filename: string }>(
        'SELECT filename FROM schema_migrations WHERE filename = $1',
        [file],
      );
      if (existing.rowCount > 0) continue;

      const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      this.logger.log(`Applying migration: ${file}`);
      await this.execMultiStatement(sqlContent);
      await this.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    }
  }

  private async execMultiStatement(sql: string): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.query(sql);
      return;
    }
    await this.enqueuePgliteOp(async () => {
      await this.pglite!.exec(sql);
    });
  }

  /**
   * Bootstraps Owner account (if OWNER_BOOTSTRAP_EMAIL & OWNER_BOOTSTRAP_PASSWORD are set)
   * and syncs environment-configured AI provider API keys encrypted at rest.
   */
  private async bootstrapEnvironmentState(): Promise<void> {
    const envProviderKeys: Array<{ code: string; envVar: string; baseUrlEnv?: string }> = [
      { code: 'openai', envVar: 'OPENAI_API_KEY', baseUrlEnv: 'OPENAI_BASE_URL' },
      { code: 'gemini', envVar: 'GEMINI_API_KEY', baseUrlEnv: 'GEMINI_BASE_URL' },
      { code: 'anthropic', envVar: 'ANTHROPIC_API_KEY', baseUrlEnv: 'ANTHROPIC_BASE_URL' },
      { code: 'openrouter_oss', envVar: 'OPENROUTER_API_KEY', baseUrlEnv: 'OPENROUTER_BASE_URL' },
    ];

    for (const item of envProviderKeys) {
      const rawKey = process.env[item.envVar];
      const customBaseUrl = item.baseUrlEnv ? process.env[item.baseUrlEnv] : undefined;
      if (rawKey && rawKey.trim().length > 0) {
        const encrypted = this.cryptoService.encrypt(rawKey.trim());
        await this.query(
          `UPDATE ai_providers
           SET api_key_encrypted = $1,
               base_url = COALESCE($2, base_url),
               health_status = 'HEALTHY',
               updated_at = NOW()
           WHERE code = $3`,
          [encrypted, customBaseUrl || null, item.code],
        );
      }
    }

    // Bootstrap initial Owner user if configured via env (or default owner in non-production dev mode)
    const ownerEmail =
      process.env.OWNER_BOOTSTRAP_EMAIL ||
      (process.env.NODE_ENV !== 'production' ? 'owner@nexora.ai' : '');
    const ownerPassword =
      process.env.OWNER_BOOTSTRAP_PASSWORD ||
      (process.env.NODE_ENV !== 'production' ? 'NexoraOwner#2026!' : '');

    if (ownerEmail && ownerPassword) {
      const existing = await this.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [
        ownerEmail,
      ]);
      if (existing.rowCount === 0) {
        const ownerRole = await this.query<{ id: string }>(
          "SELECT id FROM roles WHERE name = 'OWNER'",
        );
        if (ownerRole.rowCount > 0) {
          const passwordHash = await bcrypt.hash(ownerPassword, 12);
          const referralCode = this.cryptoService.generateReferralCode();
          await this.withTransaction(async (tx) => {
            const userIns = await tx.query<{ id: string }>(
              `INSERT INTO users (email, password_hash, full_name, country_code, role_id, referral_code, is_email_verified)
               VALUES ($1, $2, $3, 'LK', $4, $5, TRUE)
               RETURNING id`,
              [ownerEmail.toLowerCase(), passwordHash, 'NEXORA Platform Owner', ownerRole.rows[0].id, referralCode],
            );
            const userId = userIns.rows[0].id;
            const walletIns = await tx.query<{ id: string }>(
              `INSERT INTO wallets (user_id, free_credits, purchased_credits, bonus_credits, lifetime_bonus_granted)
               VALUES ($1, 300, 0, 1000, 1000)
               RETURNING id`,
              [userId],
            );
            await tx.query(
              `INSERT INTO wallet_transactions (
                 wallet_id, user_id, tx_type, credit_bucket, amount,
                 free_delta, purchased_delta, bonus_delta,
                 balance_free_after, balance_purchased_after, balance_bonus_after,
                 reference_type, idempotency_key, description
               ) VALUES ($1, $2, 'ADMIN_GRANT', 'BONUS', 1000, 300, 0, 1000, 300, 0, 1000, 'BOOTSTRAP', $3, 'Initial Owner bootstrap allocation')`,
              [walletIns.rows[0].id, userId, `bootstrap-owner-${userId}`],
            );
          });
          this.logger.log(`Bootstrapped Platform Owner account: ${ownerEmail}`);
        }
      }
    }
  }
}
