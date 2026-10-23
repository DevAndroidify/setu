import { loadEnv } from './env.schema';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
};

describe('loadEnv', () => {
  it('applies defaults for optional settings', () => {
    const env = loadEnv(valid);
    expect(env.API_PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('converts the port from text to a number', () => {
    expect(loadEnv({ ...valid, API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('rejects a missing required setting and names it', () => {
    const { REDIS_URL: _omitted, ...rest } = valid;
    expect(() => loadEnv(rest)).toThrow(/REDIS_URL/);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadEnv({ ...valid, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('does not put secret values in the error message', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'not-a-url-s3cret' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('s3cret') }),
    );
  });
});
