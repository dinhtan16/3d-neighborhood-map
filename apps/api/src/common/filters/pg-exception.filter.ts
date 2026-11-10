import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { DatabaseError } from 'pg';

/** Maps PostgreSQL constraint errors to client errors using the default Nest error format. */
@Catch(DatabaseError)
export class PgExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PgExceptionFilter.name);

  catch(err: DatabaseError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const send = (statusCode: number, message: string, error: string) => res.status(statusCode).json({ statusCode, message, error });
    switch (err.code) {
      case '23505':
        return send(HttpStatus.CONFLICT, 'Resource already exists', 'Conflict');
      case '23503':
        return send(HttpStatus.BAD_REQUEST, 'Referenced resource does not exist', 'Bad Request');
      case '23514':
      case '22P02':
      case 'XX000':
        return send(HttpStatus.BAD_REQUEST, 'Invalid input', 'Bad Request');
      default:
        this.logger.error(err.message, err.stack);
        return send(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error', 'Internal Server Error');
    }
  }
}
export { BaseExceptionFilter };
