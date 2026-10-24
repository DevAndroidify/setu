import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ email: z.email(), age: z.number().int() }));

  it('returns the parsed value when the input is valid', () => {
    expect(pipe.transform({ email: 'a@b.np', age: 3 })).toEqual({ email: 'a@b.np', age: 3 });
  });

  it('reports every invalid field with its path', () => {
    try {
      pipe.transform({ email: 'nope', age: 1.5 });
      throw new Error('expected a validation error');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { errors: { path: string }[] };
      expect(body.errors.map((e) => e.path)).toEqual(['email', 'age']);
    }
  });
});
