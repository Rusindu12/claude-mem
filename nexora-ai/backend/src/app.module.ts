import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigCoreModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { QueueModule } from './queue/queue.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { AuthModule } from './modules/auth/auth.module';
import { GrowthModule } from './modules/growth/growth.module';
import { AiEngineModule } from './modules/ai-router/ai-engine.module';
import { StorageModule } from './modules/storage/storage.module';
import { ChatModule } from './modules/chat/chat.module';
import { MediaModule } from './modules/media/media.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { JwtOrApiKeyGuard } from './common/guards';
import { GlobalExceptionFilter } from './common/global-exception.filter';

@Module({
  imports: [
    ConfigCoreModule,
    DatabaseModule,
    CacheModule,
    QueueModule,
    WalletModule,
    AuthModule,
    GrowthModule,
    AiEngineModule,
    StorageModule,
    ChatModule,
    MediaModule,
    PaymentsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtOrApiKeyGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
