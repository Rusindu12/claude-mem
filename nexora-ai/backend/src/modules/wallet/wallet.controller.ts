import { Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { AuthenticatedUser, CurrentUser } from '../../common/auth.decorators';

@ApiTags('Wallet & Credits')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(@Inject(WalletService) private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Get 3-balance credit wallet summary (Free, Purchased, Bonus)' })
  async getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.walletService.getWalletSummary(user.id);
  }

  @Post('claim-daily')
  @ApiOperation({ summary: 'Claim daily free credits (one claim per Colombo Asia/Colombo day)' })
  async claimDaily(@CurrentUser() user: AuthenticatedUser, @Req() req: any) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      '127.0.0.1';
    const device = (req.headers['x-device-fingerprint'] as string) || undefined;
    return this.walletService.claimDailyFreeCredits(user.id, ip, device);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List immutable credit wallet ledger transactions' })
  async getTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.walletService.getTransactions(
      user.id,
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0,
    );
  }
}
