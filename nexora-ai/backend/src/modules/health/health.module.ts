import { Controller, Get, Header, Inject, Module } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../../database/database.service';
import { CacheService } from '../../cache/cache.service';
import { Public } from '../../common/auth.decorators';

@ApiTags('Health, Readiness & Prometheus Metrics')
@Controller('health')
export class HealthController {
  private readonly bootTime = Date.now();

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness & readiness health check for load balancers and Kubernetes/Docker' })
  async checkHealth() {
    const dbCheck = await this.db.query<{ ok: number }>('SELECT 1 AS ok');
    const maint = await this.db.query<{ setting_value: any }>(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'platform.maintenance_mode'",
    );
    return {
      service: 'NEXORA AI Backend',
      tagline: 'INTELLIGENCE WITHOUT LIMITS',
      status: dbCheck.rowCount > 0 ? 'healthy' : 'degraded',
      database: {
        connected: dbCheck.rowCount > 0,
        driver: this.db.getDriverType(),
      },
      cache: {
        mode: this.cache.isRedisConnected() ? 'redis-cluster' : 'embedded-memory',
      },
      maintenanceMode: Boolean(maint.rows[0]?.setting_value?.enabled),
      uptimeSeconds: Math.floor((Date.now() - this.bootTime) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  @ApiOperation({ summary: 'Prometheus-compatible operational metrics endpoint' })
  async metrics(): Promise<string> {
    const [users, reqs, activeSubs] = await Promise.all([
      this.db.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM users'),
      this.db.query<{ c: string }>('SELECT COUNT(*)::text AS c FROM ai_request_logs'),
      this.db.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM subscriptions WHERE status = 'ACTIVE'"),
    ]);
    const uptime = Math.floor((Date.now() - this.bootTime) / 1000);
    return [
      '# HELP nexora_uptime_seconds Backend process uptime in seconds',
      '# TYPE nexora_uptime_seconds gauge',
      `nexora_uptime_seconds ${uptime}`,
      '# HELP nexora_users_total Total registered NEXORA AI users',
      '# TYPE nexora_users_total gauge',
      `nexora_users_total ${users.rows[0].c}`,
      '# HELP nexora_ai_requests_total Total routed AI requests',
      '# TYPE nexora_ai_requests_total counter',
      `nexora_ai_requests_total ${reqs.rows[0].c}`,
      '# HELP nexora_active_subscriptions Active paid subscriptions',
      '# TYPE nexora_active_subscriptions gauge',
      `nexora_active_subscriptions ${activeSubs.rows[0].c}`,
      '',
    ].join('\n');
  }
}

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
