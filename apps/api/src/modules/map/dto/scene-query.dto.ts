import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { BoundsDto } from '../../../common/dto/bounds.dto';
import { ToBoolean } from '../../../common/pipes/transforms';

export class SceneQueryDto extends BoundsDto {
  @IsUUID() areaId: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3)
  lod?: number;

  @IsOptional() @ToBoolean() @IsBoolean()
  includeDrafts?: boolean;
}

export class ObjectsQueryDto extends BoundsDto {
  @IsUUID() areaId: string;

  @IsOptional() @ToBoolean() @IsBoolean()
  includeDrafts?: boolean;
}
