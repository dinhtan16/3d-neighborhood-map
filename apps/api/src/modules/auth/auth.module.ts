import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { APP_CONFIG, AppConfig } from '../../config/env';
import { JwtAuthGuard, OptionalJwtService } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => ({ secret: c.jwtSecret, signOptions: { expiresIn: c.jwtExpiresInSec } }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, OptionalJwtService],
  exports: [JwtModule, JwtAuthGuard, RolesGuard, OptionalJwtService],
})
export class AuthModule {}
