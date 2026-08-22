// A listen failure is fatal in a way the process-wide handlers cannot express.
// Left unreported, `pnpm dev` stays alive under --watch with no server bound,
// and a health check against the port is answered by whatever already owns it —
// so the wrong build looks healthy, and every request goes somewhere other than
// where the change being tested lives.
export function startupFailureMessage(error: NodeJS.ErrnoException, port: number): string {
  if (error.code === 'EADDRINUSE') {
    return (
      `Port ${port} is already in use, so this server did not start. ` +
      `Stop whatever is listening there, or pick another port with PORT=<number>. ` +
      `A second checkout serving the same port is the usual cause; /health names ` +
      `the branch each one is running.`
    );
  }
  if (error.code === 'EACCES') {
    return (
      `Not permitted to bind port ${port}, so this server did not start. ` +
      `Ports below 1024 need elevated privileges; set PORT to a higher one.`
    );
  }
  return `Could not start the server on port ${port}: ${error.message}`;
}
