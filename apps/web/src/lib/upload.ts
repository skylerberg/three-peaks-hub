import { MAX_UPLOAD_BYTES, uploadTooLargeMessage } from '@three-peaks/shared';
import { ApiError } from '../api/client.ts';

// Every upload in this app is a raw fetch whose body is the bytes, and each one
// asks this first. The API refuses an oversized body either way, but only after
// it has been sent: without this, being told no is what the whole transfer was
// spent on. The status is the one the API would have answered with, so what a
// caller routes on does not depend on which end noticed.
export function assertUploadSize(byteSize: number): void {
  if (byteSize > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, uploadTooLargeMessage(MAX_UPLOAD_BYTES, byteSize));
  }
}

// The other half every raw upload repeats: read the body, and turn a refusal
// into the one error type the screens can read. It has to be an ApiError --
// apiMessage shows that and nothing else, so a plain Error reaches a toast as
// "could not reach the server", which is what three of these four sites avoided
// and the fourth did not. One owner rather than four transcriptions.
export async function readUploadResponse<T>(response: Response, fallback: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(response.status, body.error ?? fallback, body);
  return body as T;
}
