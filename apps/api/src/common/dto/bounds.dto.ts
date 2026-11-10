import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber } from 'class-validator';

export class BoundsDto {
  @Type(() => Number) @IsNumber() @IsLongitude() minLng: number;
  @Type(() => Number) @IsNumber() @IsLatitude() minLat: number;
  @Type(() => Number) @IsNumber() @IsLongitude() maxLng: number;
  @Type(() => Number) @IsNumber() @IsLatitude() maxLat: number;
}
