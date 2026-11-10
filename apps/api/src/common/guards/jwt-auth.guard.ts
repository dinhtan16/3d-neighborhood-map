import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '../decorators/current-user.decorator';

export function extractBearer(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const [type, token] = header.split(' ');
  return type?.toLowerCase() === 'bearer' && token ? token : null;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearer(req.headers?.authorization);
    if (!token) throw new UnauthorizedException('Missing bearer token');
    try {
      req.user = await this.jwt.verifyAsync<AuthUser>(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

/** Non-throwing variant: attaches req.user when a valid token is present. */
@Injectable()
export class OptionalJwtService {
  constructor(private readonly jwt: JwtService) {}

  async userFrom(req: { headers?: Record<string, unknown> }): Promise<AuthUser | null> {
    const token = extractBearer(req.headers?.authorization);
    if (!token) return null;
    try {
      return await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      return null;
    }
  }
}
