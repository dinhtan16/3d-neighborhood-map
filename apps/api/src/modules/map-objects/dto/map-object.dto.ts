import { Type } from 'class-transformer';
import {
  IsIn, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsUUID, Max, Min, ValidateIf, ValidateNested,
} from 'class-validator';

export const OBJECT_STATUSES = ['draft', 'published'] as const;

export class ScaleDto {
  @Type(() => Number) @IsNumber() @Min(0.01) @Max(100) x: number;
  @Type(() => Number) @IsNumber() @Min(0.01) @Max(100) y: number;
  @Type(() => Number) @IsNumber() @Min(0.01) @Max(100) z: number;
}

export class CreateMapObjectDto {
  @IsUUID() areaId: string;
  @IsUUID() assetId: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() placeId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() featureId?: string | null;
  @Type(() => Number) @IsNumber() @IsLatitude() latitude: number;
  @Type(() => Number) @IsNumber() @IsLongitude() longitude: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-50) @Max(500) elevationM?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-100) @Max(100) rotation?: number;
  @IsOptional() @ValidateNested() @Type(() => ScaleDto) scale?: ScaleDto;
  @IsOptional() @IsIn(OBJECT_STATUSES) status?: (typeof OBJECT_STATUSES)[number];
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class UpdateMapObjectDto {
  @IsOptional() @IsUUID() assetId?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() placeId?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() featureId?: string | null;
  @ValidateIf((o) => o.latitude !== undefined || o.longitude !== undefined)
  @Type(() => Number) @IsNumber() @IsLatitude() latitude?: number;
  @ValidateIf((o) => o.latitude !== undefined || o.longitude !== undefined)
  @Type(() => Number) @IsNumber() @IsLongitude() longitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-50) @Max(500) elevationM?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-100) @Max(100) rotation?: number;
  @IsOptional() @ValidateNested() @Type(() => ScaleDto) scale?: ScaleDto;
  @IsOptional() @IsIn(OBJECT_STATUSES) status?: (typeof OBJECT_STATUSES)[number];
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class PublishAreaDto {
  @IsUUID() areaId: string;
}
