module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/**/*.spec.ts',
    '<rootDir>/apps/**/*.spec.ts',
    '<rootDir>/tools/**/*.spec.ts',
  ],
  // Transpile only (tsconfig isolatedModules); `npm run typecheck` does the type checking.
  transform: { '^.+\\.ts$': 'ts-jest' },
};
