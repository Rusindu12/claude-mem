import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type SystemRole = 'OWNER' | 'ADMIN' | 'SUPPORT' | 'USER';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  role: SystemRole;
  sessionId?: string;
  viaBusinessApiKey?: boolean;
  apiKeyRateLimitRpm?: number;
}

export const ROLES_KEY = 'nexora_roles';
export const Roles = (...roles: SystemRole[]) => SetMetadata(ROLES_KEY, roles);

export const PUBLIC_KEY = 'nexora_public';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const STEP_UP_OWNER_KEY = 'nexora_step_up_owner';
export const RequireOwnerStepUp = () => SetMetadata(STEP_UP_OWNER_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
