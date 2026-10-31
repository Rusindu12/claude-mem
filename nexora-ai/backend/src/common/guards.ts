import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../database/database.service';
import { CryptoService } from '../config/crypto.service';
import { CacheService } from '../cache/cache.service';
import {
  AuthenticatedUser,
  PUBLIC_KEY,
  ROLES_KEY,
  STEP_UP_OWNER_KEY,
  SystemRole,
} from './auth.decorators';

@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];
    const apiKeyHeader: string | undefined = req.headers['x-api-key'];

    let rawBearer = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      rawBearer = authHeader.slice(7).trim();
    } else if (apiKeyHeader) {
      rawBearer = apiKeyHeader.trim();
    }

    if (!rawBearer) {
      throw new UnauthorizedException('Authentication token or Business API key required');
    }

    let user: AuthenticatedUser;
    if (rawBearer.startsWith('nxr_live_')) {
      user = await this.authenticateBusinessApiKey(rawBearer);
    } else {
      user = await this.authenticateJwt(rawBearer);
    }

    // Check global platform maintenance mode (Owner always bypasses so they can turn it back off)
    if (user.role !== 'OWNER') {
      const maint = await this.getMaintenanceSetting();
      if (maint.enabled) {
        throw new ServiceUnavailableException(
          maint.message || 'NEXORA AI is currently under scheduled maintenance.',
        );
      }
    }

    req.user = user;
    return true;
  }

  private async authenticateJwt(token: string): Promise<AuthenticatedUser> {
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_ACCESS_SECRET || 'nexora-dev-jwt-access-secret-change-in-prod!',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const res = await this.db.query<{
      id: string;
      email: string;
      full_name: string;
      is_active: boolean;
      is_suspended: boolean;
      role_name: SystemRole;
    }>(
      `SELECT u.id, u.email, u.full_name, u.is_active, u.is_suspended, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [payload.sub],
    );

    if (res.rowCount === 0) {
      throw new UnauthorizedException('Account no longer exists');
    }
    const row = res.rows[0];
    if (!row.is_active || row.is_suspended) {
      throw new ForbiddenException('Account is suspended or deactivated');
    }

    // Verify session is not revoked if sessionId present
    if (payload.sid) {
      const sess = await this.db.query<{ is_revoked: boolean }>(
        'SELECT is_revoked FROM sessions WHERE id = $1',
        [payload.sid],
      );
      if (sess.rowCount > 0 && sess.rows[0].is_revoked) {
        throw new UnauthorizedException('Session has been revoked; please sign in again');
      }
    }

    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role_name,
      sessionId: payload.sid,
    };
  }

  private async authenticateBusinessApiKey(rawKey: string): Promise<AuthenticatedUser> {
    const keyHash = this.crypto.sha256(rawKey);
    const res = await this.db.query<{
      key_id: string;
      rate_limit_rpm: number;
      expires_at: string | null;
      user_id: string;
      email: string;
      full_name: string;
      is_active: boolean;
      is_suspended: boolean;
      role_name: SystemRole;
    }>(
      `SELECT k.id AS key_id, k.rate_limit_rpm, k.expires_at,
              u.id AS user_id, u.email, u.full_name, u.is_active, u.is_suspended,
              r.name AS role_name
       FROM business_api_keys k
       JOIN users u ON u.id = k.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE k.key_hash = $1 AND k.is_active = TRUE`,
      [keyHash],
    );

    if (res.rowCount === 0) {
      throw new UnauthorizedException('Invalid or revoked Business API key');
    }
    const row = res.rows[0];
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      throw new UnauthorizedException('Business API key has expired');
    }
    if (!row.is_active || row.is_suspended) {
      throw new ForbiddenException('Account associated with API key is suspended');
    }

    const rl = await this.cache.checkRateLimit(`apikey:${row.key_id}`, row.rate_limit_rpm, 60);
    if (!rl.allowed) {
      throw new ForbiddenException(`Business API key rate limit (${row.rate_limit_rpm} RPM) exceeded`);
    }

    await this.db.query('UPDATE business_api_keys SET last_used_at = NOW() WHERE id = $1', [
      row.key_id,
    ]);

    return {
      id: row.user_id,
      email: row.email,
      fullName: row.full_name,
      role: row.role_name,
      viaBusinessApiKey: true,
      apiKeyRateLimitRpm: row.rate_limit_rpm,
    };
  }

  private async getMaintenanceSetting(): Promise<{ enabled: boolean; message?: string }> {
    const cached = await this.cache.get<{ enabled: boolean; message?: string }>('sys:maintenance');
    if (cached) return cached;

    const res = await this.db.query<{ setting_value: any }>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'platform.maintenance_mode'",
    );
    const val = res.rowCount > 0 ? res.rows[0].setting_value : { enabled: false };
    await this.cache.set('sys:maintenance', val, 15);
    return val;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<SystemRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiresStepUp = this.reflector.getAllAndOverride<boolean>(STEP_UP_OWNER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = req.user;

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Insufficient privileges: requires role [${requiredRoles.join(', ')}]`,
      );
    }

    // Sensitive Owner/Administrative operations require step-up password confirmation header
    if (requiresStepUp) {
      const confirmPwd = req.headers['x-confirm-password'];
      if (!confirmPwd || typeof confirmPwd !== 'string') {
        throw new ForbiddenException(
          'Sensitive administrative action requires step-up password verification (X-Confirm-Password header)',
        );
      }
      const userRow = await this.db.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [user.id],
      );
      if (userRow.rowCount === 0) {
        throw new UnauthorizedException('User not found');
      }
      const matches = await bcrypt.compare(confirmPwd, userRow.rows[0].password_hash);
      if (!matches) {
        throw new ForbiddenException('Step-up password verification failed');
      }
      req.stepUpVerified = true;
    }

    return true;
  }
}
