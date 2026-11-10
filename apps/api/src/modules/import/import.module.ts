import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportProcessor } from './import.processor';

@Module({ controllers: [ImportController], providers: [ImportService, ImportProcessor] })
export class ImportModule {}
