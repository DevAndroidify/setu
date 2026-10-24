export default async function globalTeardown(): Promise<void> {
  await Promise.all((globalThis.__containers ?? []).map((container) => container.stop()));
}
