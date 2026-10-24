import argon2 from 'argon2';

/** argon2id with the library's defaults (memory-hard, OWASP-recommended parameters). */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false; // malformed hash
  }
}
