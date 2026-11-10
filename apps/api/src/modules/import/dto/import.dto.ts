import { Type } from 'class-transformer';
import { IsUUID, ValidateNested } from 'class-validator';
import { BoundsDto } from '../../../common/dto/bounds.dto';

export class StartOsmImportDto {
  @IsUUID() areaId: string;
  @ValidateNested() @Type(() => BoundsDto) bounds: BoundsDto;
}
