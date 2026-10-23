module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/apps/**/*.spec.ts'],
  transform: { '^.+\.ts$': 'ts-jest' },
};
