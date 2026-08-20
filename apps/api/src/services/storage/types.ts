import type { Readable } from 'node:stream';

export interface StoredObject {
  stream: Readable;
  contentType: string;
  byteSize: number;
}

export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  putStream(key: string, data: Readable, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  // Returns null before any byte has been written to the response, so a caller
  // can still answer 404. A stream that 404s halfway is not a 404.
  getStream(key: string): Promise<StoredObject | null>;
  copy(sourceKey: string, destKey: string): Promise<void>;
  delete(key: string): Promise<void>;
}
