import argon2 from 'argon2';

// argon2id at the library's defaults.
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // A malformed stored hash is a failed verification, not a 500.
    return false;
  }
}

// A real argon2id hash of a value nobody knows.
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$kxe2X3UmiK6KIEdheol9yA$4EkUGsZPfPnPm5heHSxj4mq4oCH131gXs1QamKga2w0';

// Called by login when the address is unknown. Without it, "no such account"
// returns in microseconds and "wrong password" takes an argon2 verify — which
// is a remotely measurable oracle for which addresses have accounts.
export async function verifyDummyPassword(password: string): Promise<void> {
  await verifyPassword(DUMMY_PASSWORD_HASH, password);
}
