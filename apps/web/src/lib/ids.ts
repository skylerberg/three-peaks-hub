// IDs are generated on the client so the UI can act optimistically: the row it
// draws already has the id the server will store. eslint restricts `uuid` so
// the point is made where that import would go.
export function newId(): string {
  return crypto.randomUUID();
}
