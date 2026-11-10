import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, timingSafeEqual } from 'crypto';
import type { LoginResponse } from '@nmap/map-contracts';
import { APP_CONFIG, AppConfig } from '../../config/env';

function safeEqual(a: string, b: string): boolean {
  // Hash first so inputs have equal length and comparison time is constant.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const emailOk = safeEqual(email.trim().toLowerCase(), this.config.adminEmail.trim().toLowerCase());
    const passOk = safeEqual(password, this.config.adminPassword);
    if (!(emailOk && passOk)) throw new UnauthorizedException('Invalid credentials');
    const user = { email: this.config.adminEmail, role: 'admin' as const };
    const accessToken = await this.jwt.signAsync({ sub: user.email, ...user });
    return { accessToken, expiresIn: this.config.jwtExpiresInSec, user };
  }
}
