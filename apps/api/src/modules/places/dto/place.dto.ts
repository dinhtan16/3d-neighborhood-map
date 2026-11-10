import { Type } from 'class-transformer';
import {
  IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches,
  Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { LIMITS } from '@nmap/map-config';
import { Sanitize } from '../../../common/pipes/transforms';

export const PLACE_STATUSES = ['active', 'inactive', 'pending'] as const;

export class CreatePlaceDto {
  @Sanitize() @IsString() @MinLength(1) @MaxLength(255) name: string;
  @IsUUID() categoryId: string;
  @Type(() => Number) @IsNumber() @IsLatitude() latitude: number;
  @Type(() => Number) @IsNumber() @IsLongitude() longitude: number;
  @IsOptional() @Sanitize() @IsString() @MaxLength(1000) address?: string;
  @IsOptional() @Sanitize() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @Matches(/^[0-9+().\s-]{3,30}$/, { message: 'phone must be a valid phone number' }) phone?: string;
  @IsOptional() @IsIn(PLACE_STATUSES) status?: (typeof PLACE_STATUSES)[number];
  @IsOptional() @IsObject() openingHours?: Record<string, unknown>;
}

export class UpdatePlaceDto {
  @IsOptional() @Sanitize() @IsString() @MinLength(1) @MaxLength(255) name?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @ValidateIf((o) => o.longitude !== undefined || o.latitude !== undefined)
  @Type(() => Number) @IsNumber() @IsLatitude() latitude?: number;
  @ValidateIf((o) => o.longitude !== undefined || o.latitude !== undefined)
  @Type(() => Number) @IsNumber() @IsLongitude() longitude?: number;
  @IsOptional() @Sanitize() @IsString() @MaxLength(1000) address?: string;
  @IsOptional() @Sanitize() @IsString() @MaxLength(5000) description?: string;
  @IsOptional() @IsString() @Matches(/^[0-9+().\s-]{3,30}$/, { message: 'phone must be a valid phone number' }) phone?: string;
  @IsOptional() @IsIn(PLACE_STATUSES) status?: (typeof PLACE_STATUSES)[number];
  @IsOptional() @IsObject() openingHours?: Record<string, unknown>;
}

export class SearchPlacesDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() areaId?: string;
  @IsOptional() @IsIn(PLACE_STATUSES) status?: (typeof PLACE_STATUSES)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(LIMITS.maxSearchResults) limit?: number;
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}

export class NearbyPlacesDto {
  @Type(() => Number) @IsNumber() @IsLatitude() lat: number;
  @Type(() => Number) @IsNumber() @IsLongitude() lng: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(LIMITS.maxNearbyRadiusM) radius?: number;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(LIMITS.maxSearchResults) limit?: number;
}

export class CreatePlaceImageDto {
  @IsString() @MaxLength(2048)
  @Matches(/^(https?:\/\/[^\s]+|images\/[A-Za-z0-9._-]+)$/, { message: 'imageUrl must be an http(s) URL or an uploaded images/ path' })
  imageUrl: string;
  @IsOptional() @Sanitize() @IsString() @MaxLength(255) altText?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}
