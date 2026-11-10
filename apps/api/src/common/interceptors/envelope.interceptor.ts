import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';

/** Wraps responses as { data, meta: { timestamp, ... } }. Handlers may return { data, meta } to add meta. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body) => {
        if (body instanceof StreamableFile) return body;
        const timestamp = new Date().toISOString();
        if (body && typeof body === 'object' && 'data' in body && Object.keys(body).every((k) => k === 'data' || k === 'meta')) {
          return { data: (body as any).data, meta: { timestamp, ...((body as any).meta ?? {}) } };
        }
        return { data: body ?? null, meta: { timestamp } };
      }),
    );
  }
}
