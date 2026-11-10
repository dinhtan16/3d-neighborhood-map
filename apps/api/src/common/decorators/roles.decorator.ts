import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';

export type Role = 'admin';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Requires a valid bearer token carrying the admin role. */
export const AdminOnly = () => applyDecorators(UseGuards(JwtAuthGuard, RolesGuard), Roles('admin'));
