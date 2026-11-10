import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ImportService } from './import.service';
import { StartOsmImportDto } from './dto/import.dto';
import { AdminOnly } from '../../common/decorators/roles.decorator';

@Controller('admin/map/import')
@AdminOnly()
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Post('osm')
  @HttpCode(202)
  start(@Body() dto: StartOsmImportDto) {
    return this.imports.startOsmImport(dto);
  }

  @Get('jobs/:id')
  job(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.getJob(id);
  }
}
