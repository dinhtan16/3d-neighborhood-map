import { Transform } from 'class-transformer';
import { sanitizeText } from '../utils/text';

/** Query-string boolean: 'true' / '1' => true. */
export const ToBoolean = () =>
  Transform(({ value }) => (typeof value === 'boolean' ? value : value === 'true' || value === '1'));

export const Sanitize = () => Transform(({ value }) => sanitizeText(value));
