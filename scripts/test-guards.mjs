// Mutation testing. Each entry names a bug and the exact edit that puts it
// back; the runner requires the named tests to FAIL with that edit in place.
//
// This exists because a unit test can measure nothing and still report green --
// a stale expectation, a fixture that stopped reaching the code path, an
// assertion that was already true before the fix. A guard whose tests still
// pass has stopped guarding anything, and nothing else in the repo can tell you
// that.
//
// Rules for adding one:
//   * `find` must match EXACTLY ONCE in the file. A pattern that matches
//     nothing leaves the source correct and the tests green, which is
//     indistinguishable from a guard that works.
//   * `testName` should be narrow enough that exactly one case fails. A widened
//     name can turn a five-second failure into a run with no upper bound.
//   * The bug should be one a reviewer would plausibly introduce, not a
//     syntactic nonsense that fails to compile.

export const guards = [
  {
    name: 'a caller with no access gets 404, not 403',
    package: 'api',
    file: 'src/services/authorization.ts',
    // The classic mistake: refusing with the "honest" status, which tells an
    // outsider the project exists.
    find: "    throw new AppError(404, 'Project not found');\n  }\n\n  return { projectId, role: normalizeProjectRole(row.role), isCreator: false };",
    replace:
      "    throw new AppError(403, 'Project not found');\n  }\n\n  return { projectId, role: normalizeProjectRole(row.role), isCreator: false };",
    tests: ['tests/e2e/authorization.test.ts'],
    testName: 'sees 404, not 403, when reading',
  },
  {
    name: 'project roles normalize fail-closed',
    package: 'api',
    file: 'packages/shared/src/roles.ts',
    root: true,
    find: "  return role === 'editor' ? 'editor' : 'viewer';",
    replace: "  return (role ?? 'viewer') as ProjectRole;",
    tests: ['src/roles.test.ts'],
    testName: 'reads',
    runner: 'shared',
  },
  {
    name: 'a viewer cannot write',
    package: 'api',
    file: 'src/services/authorization.ts',
    find: "  if (access.role !== 'editor') {",
    replace: '  if (false) {',
    tests: ['tests/e2e/authorization.test.ts'],
    testName: 'is refused writes with 403',
  },
  {
    name: 'the upload content type comes from magic bytes, not the client',
    package: 'api',
    file: 'src/services/files.ts',
    find: "    contentType: sniffed ?? 'application/octet-stream',",
    replace: '    contentType: declaredContentType,',
    tests: ['tests/e2e/files.test.ts'],
    testName: 'decides the content type by magic bytes',
  },
  {
    name: 'RIFF that is not WebP is not an image',
    package: 'api',
    file: 'src/services/imageSniff.ts',
    find: 'startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)',
    replace: 'true',
    tests: ['src/services/imageSniff.test.ts'],
    testName: 'does not accept RIFF without the WEBP tag',
  },
  {
    name: 'a mutation that fails rolls the whole request back',
    package: 'api',
    file: 'src/middleware/transaction.ts',
    // Without the rethrow, Hono's compose has already swallowed the error onto
    // c.error and Kysely sees a clean return -- so the partial write commits.
    find: '    if (c.error) throw c.error;',
    replace: '    if (false) throw c.error;',
    tests: ['tests/unit/transactionMiddleware.test.ts'],
    testName: 'rolls back a write when a later step in the same request throws',
  },
  {
    name: 'a reset link cannot be spent twice',
    package: 'api',
    file: 'src/routes/auth.ts',
    find: "        alternative_id: newId(),\n        updated_at: new Date(),\n      })\n      .where('app_user.id', '=', claims.sub)",
    replace:
      "        updated_at: new Date(),\n      })\n      .where('app_user.id', '=', claims.sub)",
    tests: ['tests/e2e/auth.test.ts'],
    testName: 'mails a link that sets a new password exactly once',
  },
  {
    name: 'one token family cannot be spent as another',
    package: 'api',
    file: 'src/services/signedToken.ts',
    find: '  if (parsed[TYPE_CLAIM] !== tokenType) return null;',
    replace: '  if (false) return null;',
    tests: ['tests/unit/signedToken.test.ts'],
    testName: 'refuses a token of one family presented as another',
  },
  {
    // The dummy-password verify beside this line closes a timing oracle, and no
    // test can observe timing -- a guard aimed at that line would report
    // STILL-PASSED forever. What a test CAN observe is that both answers are
    // byte-identical, so that is what this breaks.
    name: 'an unknown email and a wrong password give the same answer',
    package: 'api',
    file: 'src/routes/auth.ts',
    find: "      throw new AppError(401, 'Invalid email or password');\n    }\n\n    if (!(await verifyPassword(row.password_hash, password))) {",
    replace:
      "      throw new AppError(401, 'No account with that email');\n    }\n\n    if (!(await verifyPassword(row.password_hash, password))) {",
    tests: ['tests/e2e/auth.test.ts'],
    testName: 'answers 401 identically for an unknown address',
  },
  {
    name: 'undeclared request fields are stripped, not stored',
    package: 'api',
    file: 'src/middleware/validators.ts',
    find: "  const stripped = schema.onDeepUndeclaredKey('delete');",
    replace: '  const stripped = schema;',
    tests: ['tests/unit/jsonValidator.test.ts'],
    testName: 'strips a key the schema does not declare',
  },
  {
    // The shallow form leaves a nested object untouched, and a settings blob is
    // stored as jsonb exactly as it survives validation.
    name: 'undeclared fields are stripped from a nested object too',
    package: 'api',
    file: 'src/middleware/validators.ts',
    find: "  const stripped = schema.onDeepUndeclaredKey('delete');",
    replace: "  const stripped = schema.onUndeclaredKey('delete');",
    tests: ['tests/e2e/models.test.ts'],
    testName: 'strips a field the schema does not declare',
  },
  {
    // Subscribing is not authorization; the per-event access check is. Without
    // it, naming any project id in a subscribe frame would deliver that
    // project's events to anyone.
    name: 'realtime delivery re-checks access for every event',
    package: 'api',
    file: 'src/services/realtime/transport.ts',
    find: '          if (allowed) connection.socket.send(message);',
    replace: '          void allowed; connection.socket.send(message);',
    tests: ['tests/e2e/realtime.test.ts'],
    testName: 'delivers nothing to someone who subscribed to a project they cannot read',
  },
  {
    name: 'nothing is published for a request that rolled back',
    package: 'api',
    file: 'src/services/realtime/index.ts',
    find: '  hooks.push(async () => {\n    await publish({ type, payload: { ...payload, actor_user_id: actorUserId } });\n  });',
    replace:
      '  void hooks;\n  void publish({ type, payload: { ...payload, actor_user_id: actorUserId } });',
    tests: ['tests/unit/realtimeBus.test.ts'],
    testName: 'publishes nothing until the hook it queued is run',
  },
  {
    name: 'a superseded directory load does not overwrite a newer one',
    package: 'web',
    file: 'src/lib/files.svelte.ts',
    find: '      if (generation !== this.#generation) return;',
    replace: '      if (false) return;',
    tests: ['src/lib/files.svelte.test.ts'],
    testName: 'discards a response that a newer request has already superseded',
    runner: 'web',
  },
  {
    name: 'a signed-out visitor is sent to login',
    package: 'web',
    file: 'src/lib/session.svelte.ts',
    find: "    if (this.status === 'anon' && !isPublic) {",
    replace: '    if (false) {',
    tests: ['src/lib/guard.svelte.test.ts'],
    testName: 'sends a signed-out visitor to login',
    runner: 'web',
  },
  {
    name: 'an html page containing an inline svg is not an svg',
    package: 'api',
    file: 'src/services/imageSniff.ts',
    find: '  return /^<svg[\\s/>]/i.test(skipXmlPreamble(text));',
    replace: "  return text.includes('<svg');",
    tests: ['src/services/imageSniff.test.ts'],
    testName: 'does not accept HTML with an inline svg element',
  },
  {
    name: 'saving 3D settings needs write access, not merely read',
    package: 'api',
    file: 'src/routes/models.ts',
    find: "    const access = await assertFileAccess(c, fileId, 'write');",
    replace: "    const access = await assertFileAccess(c, fileId, 'read');",
    tests: ['tests/e2e/models.test.ts'],
    testName: 'a viewer is refused with 403',
  },
  {
    name: 'the back face of a card is mirrored',
    package: 'web',
    file: 'src/lib/model3d/geometry/faceGroups.ts',
    find: '    const u = nz > 0 ? (x - bounds.minX) / width : (bounds.maxX - x) / width;',
    replace: '    const u = (x - bounds.minX) / width;',
    tests: ['src/lib/model3d/geometry/faceGroups.test.ts'],
    testName: 'mirrors the back face across the front',
    runner: 'web',
  },
  {
    name: 'a bevel does not grow the piece past the size it was given',
    package: 'web',
    file: 'src/lib/model3d/geometry/extrude.ts',
    find: '    bevelOffset: -bevel,',
    replace: '    bevelOffset: 0,',
    tests: ['src/lib/model3d/geometry/faceGroups.test.ts'],
    testName: 'builds a card in metres, straddling the origin',
    runner: 'web',
  },
  {
    name: 'no screen is mounted before the first-load guard has run',
    package: 'web',
    file: 'src/App.svelte',
    // Reading the status directly reopens the window the flag exists to close:
    // init() leaves `unknown` a microtask before the guard redirects, and a
    // screen mounted in between fetches with the token init has just cleared.
    find: '    {#if !booted}',
    replace: "    {#if session.status === 'unknown'}",
    tests: ['src/boot.svelte.test.ts'],
    testName: 'does not fetch with a token the session has just cleared',
    runner: 'web',
  },
  {
    name: 'the projects list is asked for once per screen',
    package: 'web',
    file: 'src/lib/projects.svelte.ts',
    find: '    this.#attempt ??= this.#load();',
    replace: '    this.#attempt = this.#load();',
    tests: ['src/lib/projects.svelte.test.ts'],
    testName: 'asks the server once even when the screen asks again',
    runner: 'web',
  },
  {
    name: 'a reset forgets the attempt the previous account made',
    package: 'web',
    file: 'src/lib/projects.svelte.ts',
    find: '    this.loading = false;\n    this.#attempt = null;',
    replace: '    this.loading = false;',
    tests: ['src/lib/projects.svelte.test.ts'],
    testName: 'asks again for the next account after a reset',
    runner: 'web',
  },
  {
    name: 'the storage meter counts every version, not just the current one',
    package: 'api',
    file: 'src/services/files.ts',
    // Summing the mirror counts each file once, at its newest size, so the
    // meter drifts further from the truth with every version that is kept.
    find: "eb.fn.sum<string>('file_version.byte_size')",
    replace: "eb.fn.sum<string>('file.byte_size')",
    tests: ['tests/e2e/fileVersions.test.ts'],
    testName: 'counts every version against the project quota',
  },
  {
    name: 'a restore copies the object forward rather than re-pointing at the old one',
    package: 'api',
    file: 'src/routes/files.ts',
    // Two versions naming one object means deleting either takes the other's
    // bytes. The unique index on file_version.storage_key is what turns this
    // into a constraint failure instead of silent aliasing.
    find: '    const destinationKey = newId();',
    replace: '    const destinationKey = source.storage_key;',
    tests: ['tests/e2e/fileVersions.test.ts'],
    testName: 'restores an older version by appending a copy',
  },
  {
    name: 'identical bytes do not create a version',
    package: 'api',
    file: 'src/services/files.ts',
    find: '  return current.checksum !== null && current.checksum === candidate.checksum;',
    replace: '  return false;',
    tests: ['tests/e2e/fileVersions.test.ts'],
    testName: 're-uploading identical bytes creates nothing',
  },
  {
    name: 'a superseded version listing cannot overwrite a newer one',
    package: 'web',
    file: 'src/lib/versions.svelte.ts',
    find: '      if (generation !== this.#generation) return;',
    replace: '      if (false) return;',
    tests: ['src/lib/versions.svelte.test.ts'],
    testName: 'discards a response that a newer request has already superseded',
    runner: 'web',
  },
  {
    name: 'the screen is told when identical bytes created nothing',
    package: 'web',
    file: 'src/lib/versions.svelte.ts',
    find: '    return body.created === true;',
    replace: '    return true;',
    tests: ['src/lib/versions.svelte.test.ts'],
    testName: 'reports that identical bytes created nothing',
    runner: 'web',
  },
];
