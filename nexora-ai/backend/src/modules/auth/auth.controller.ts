import { Body, Controller, Get, Inject, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthenticatedUser, CurrentUser, Public } from '../../common/auth.decorators';

@ApiTags('Authentication & Profile')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new NEXORA AI account with wallet & referral support' })
  async register(@Body() body: any, @Req() req: any) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
    return this.authService.register(body, ip, req.headers['user-agent'] || 'NEXORA-Client');
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Sign in and receive access + rotating refresh tokens' })
  async login(@Body() body: any, @Req() req: any) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
    return this.authService.login(body, ip, req.headers['user-agent'] || 'NEXORA-Client');
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate refresh token and issue fresh JWT access token' })
  async refresh(@Body() body: { refreshToken: string }, @Req() req: any) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
    return this.authService.refreshTokens(
      body?.refreshToken,
      ip,
      req.headers['user-agent'] || 'NEXORA-Client',
    );
  }

  @ApiBearerAuth()
  @Post('logout')
  @ApiOperation({ summary: 'Revoke current or all refresh-token sessions' })
  async logout(@CurrentUser() user: AuthenticatedUser, @Body() body?: { allDevices?: boolean }) {
    return this.authService.logout(user.id, body?.allDevices ? undefined : user.sessionId);
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password recovery token' })
  async forgotPassword(@Body() body: { email: string }, @Req() req: any) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
    return this.authService.requestPasswordRecovery(body?.email, ip);
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password using single-use recovery token' })
  async resetPassword(@Body() body: { token: string; newPassword: string }) {
    return this.authService.resetPassword(body?.token, body?.newPassword);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Get authenticated user profile and active subscription tier' })
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getUserProfile(user.id);
  }

  @ApiBearerAuth()
  @Patch('me')
  @ApiOperation({ summary: 'Update language (en/si), theme (dark/light), privacy & profile settings' })
  async updateMe(@CurrentUser() user: AuthenticatedUser, @Body() body: any) {
    return this.authService.updateProfile(user.id, body);
  }
  @ApiBearerAuth()
  @Post('change-password')
  @ApiOperation({ summary: 'Change authenticated user password' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    return this.authService.changePassword(user.id, body?.currentPassword, body?.newPassword);
  }
}
