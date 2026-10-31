import { Global, Module } from '@nestjs/common';
import { CostManagementService } from '../cost-management/cost-management.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { AiRouterService } from './ai-router.service';
import { WalletModule } from '../wallet/wallet.module';

@Global()
@Module({
  imports: [WalletModule],
  providers: [CostManagementService, AiProvidersService, AiRouterService],
  exports: [CostManagementService, AiProvidersService, AiRouterService],
})
export class AiEngineModule {}
