import { BadRequestException } from '@nestjs/common';
import { validateBounds } from '@nmap/geo-core';
import type { GeoBounds } from '@nmap/shared-types';

export function assertValidBounds(b: GeoBounds, maxAreaDeg2?: number): void {
  const errors = validateBounds(b, maxAreaDeg2);
  if (errors.length) throw new BadRequestException(errors.length === 1 ? `Invalid geographic bounds: ${errors[0]}` : errors.map((e) => `Invalid geographic bounds: ${e}`));
}
