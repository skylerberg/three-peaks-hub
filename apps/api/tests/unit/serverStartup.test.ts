import { describe, expect, it } from 'vitest';
import { startupFailureMessage } from '../../src/utils/serverStartup.ts';

function listenError(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`listen ${code}`);
  error.code = code;
  return error;
}

describe('startupFailureMessage', () => {
  // The failure this exists for: a second checkout already owns the port, the
  // process stays up under --watch with nothing bound, and every request goes
  // to the other build.
  it('names the port and how to move off it when it is taken', () => {
    const message = startupFailureMessage(listenError('EADDRINUSE'), 3001);
    expect(message).toContain('3001');
    expect(message).toContain('PORT=');
    expect(message).toContain('/health');
  });

  it('explains a privileged port rather than repeating the code', () => {
    const message = startupFailureMessage(listenError('EACCES'), 80);
    expect(message).toContain('80');
    expect(message).toMatch(/privilege/i);
  });

  it('falls back to the underlying message for anything else', () => {
    const error = listenError('EPERM');
    expect(startupFailureMessage(error, 3001)).toContain('listen EPERM');
  });
});
