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
    name: 'an upload declaring an oversized length never starts',
    package: 'api',
    file: 'src/routes/files.ts',
    // Without this the body is read to the cap and refused there, which costs
    // the whole transfer and can no longer say how big the file was.
    find:
      '    assertUploadSize(declaredLength);\n' +
      '    if (declaredLength > 0) await assertQuota(c, projectId, declaredLength);',
    replace: '    if (declaredLength > 0) await assertQuota(c, projectId, declaredLength);',
    tests: ['tests/e2e/files.test.ts'],
    testName: 'refuses an upload whose declared length is over the limit',
  },
  {
    name: 'an oversized upload is refused before it is sent',
    package: 'web',
    file: 'src/lib/upload.ts',
    find: '  if (byteSize > MAX_UPLOAD_BYTES) {',
    replace: '  if (false) {',
    tests: ['src/lib/files.svelte.test.ts'],
    testName: 'refuses a file over the limit without sending it',
    runner: 'web',
  },
  {
    name: 'a refused upload reaches the screen as what the API said',
    package: 'web',
    file: 'src/lib/files.svelte.ts',
    // apiMessage shows an ApiError and nothing else, so the plain Error this
    // threw before reached the toast as "could not reach the server".
    find: '        throw new ApiError(',
    replace: '        throw new Error(',
    tests: ['src/lib/files.svelte.test.ts'],
    testName: 'carries the refusal the API wrote out to the caller',
    runner: 'web',
  },
  {
    name: 'the upload cap does not leave its refusal unhandled',
    package: 'api',
    file: 'src/services/files.ts',
    // Without the listener the cap emits on a stream nothing is watching yet,
    // which is an uncaught exception rather than a 413.
    find: "  counted.on('error', () => {});",
    replace: '  void counted;',
    tests: ['src/services/files.test.ts'],
    testName: 'refuses a body past the cap',
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
  {
    name: 'the object URL outlives the click that reads it',
    package: 'web',
    file: 'src/lib/download.ts',
    // Only Chromium takes its blob reference during the click's synchronous
    // dispatch, so a same-task revoke passes every check run against it and
    // downloads nothing in Firefox and WebKit.
    find: '  setTimeout(() => URL.revokeObjectURL(url), 0);',
    replace: '  URL.revokeObjectURL(url);',
    tests: ['src/lib/download.test.ts'],
    testName: 'defers revoking the object URL until after the click',
    runner: 'web',
  },
  {
    name: 'a reconnected socket replays what it was watching',
    package: 'web',
    file: 'src/lib/realtime.svelte.ts',
    // The subscriptions live on the store rather than on the socket precisely
    // so a reconnect can replay them. Dropping the replay leaves a healthy
    // connection that delivers nothing.
    find: '      for (const projectId of this.#projects) {',
    replace: '      for (const projectId of []) {',
    tests: ['src/lib/realtime.svelte.test.ts'],
    testName: 're-subscribes to everything it was watching when it reconnects',
    runner: 'web',
  },
  {
    name: 'a socket closed for a dead credential is not reopened',
    package: 'web',
    file: 'src/lib/realtime.svelte.ts',
    find: "      if (action === 'revalidate') return;",
    replace: '      if (false) return;',
    tests: ['src/lib/realtime.svelte.test.ts'],
    testName: 'does not reconnect after the server says the credential is gone',
    runner: 'web',
  },
  {
    name: 'a thumbnail presents the credential its bytes are behind',
    package: 'web',
    file: 'src/components/Thumbnail.svelte',
    // Exactly the shape the `<img src>` this replaced had: a request the
    // browser makes on its own carries no Authorization header, and every
    // thumbnail in the explorer answered 401.
    find:
      '        const response = await fetch(`/api/files/${id}/download${query}`, {\n' +
      '          headers: authHeader(),\n' +
      '        });',
    replace: '        const response = await fetch(`/api/files/${id}/download${query}`);',
    tests: ['src/components/Thumbnail.svelte.test.ts'],
    testName: 'reads the bytes with the credential and shows them',
    runner: 'web',
  },
  {
    // Yesterday's row drawn with today's artwork is precisely the lie the whole
    // history feature exists to prevent.
    name: 'a history thumbnail is drawn at the version the run left',
    package: 'web',
    file: 'src/routes/DeckRun.svelte',
    find: 'version={card.file_version_number ?? undefined}',
    replace: 'version={undefined}',
    tests: ['src/routes/DeckRun.svelte.test.ts'],
    testName: 'asks for each thumbnail at the version this run left',
    runner: 'web',
  },
  {
    // Both panes falling back to the current file makes every comparison look
    // like two copies of the same image.
    name: 'a comparison reads each side at its own version',
    package: 'web',
    file: 'src/routes/FileVersions.svelte',
    find: 'version={side.version_number}',
    replace: 'version={undefined}',
    tests: ['src/routes/FileVersions.svelte.test.ts'],
    testName: 'draws each side at its own version, not the current file',
    runner: 'web',
  },
  {
    // Purging is the one destructive act in the system, and a card it took is
    // named rather than requested as bytes nothing can serve.
    name: 'a purged card is named rather than drawn',
    package: 'web',
    file: 'src/routes/DeckRun.svelte',
    find: '{#if card.file_id === null}',
    replace: '{#if false}',
    tests: ['src/routes/DeckRun.svelte.test.ts'],
    testName: 'names a purged card instead of drawing a broken thumbnail',
    runner: 'web',
  },
  {
    // The route block is not keyed, so a slower listing landing late would
    // otherwise put one deck's runs under another deck's heading.
    name: 'a superseded run listing cannot overwrite a newer one',
    package: 'web',
    file: 'src/lib/deckHistory.svelte.ts',
    find: '      if (generation !== this.#runsGeneration) return;',
    replace: '      if (false) return;',
    tests: ['src/lib/deckHistory.svelte.test.ts'],
    testName: 'discards a run listing a newer request has already superseded',
    runner: 'web',
  },
  {
    name: "a deck's history belongs to the deck it was read for",
    package: 'web',
    file: 'src/lib/deckHistory.svelte.ts',
    find: '    this.runsDeckId = null;\n    this.runs = [];\n',
    replace: '',
    tests: ['src/lib/deckHistory.svelte.test.ts'],
    testName: "drops the previous deck's runs before the next deck's answer lands",
    runner: 'web',
  },
  {
    // A readiness probe that answers from memory alone puts a pod with no
    // database back into the load balancer's rotation.
    name: 'health reaches the database rather than answering ok regardless',
    package: 'api',
    file: 'src/routes/health.ts',
    find: "    await ping(c.get('db'));",
    replace: '',
    tests: ['tests/e2e/health.test.ts'],
    testName: 'reaches the database rather than answering from memory alone',
  },
  {
    name: 'a database missing a migration is reported as behind',
    package: 'api',
    file: 'src/db/migrate.ts',
    // The failure that matters is the quiet one: a check that always says the
    // database is current is indistinguishable from not having the check.
    find: '    .filter((migration) => migration.executedAt === undefined)',
    replace: '    .filter(() => false)',
    tests: ['tests/unit/pendingMigrations.test.ts'],
    testName: 'names a migration the database has never run',
  },
  {
    name: 'the directory listing hides what has been deleted',
    package: 'api',
    file: 'src/routes/files.ts',
    find: "        .where('file.project_id', '=', projectId)\n        .where('file.deleted_at', 'is', null)",
    replace: "        .where('file.project_id', '=', projectId)",
    tests: ['tests/e2e/softDelete.test.ts'],
    testName: 'hides a soft-deleted file from the directory listing',
  },
  {
    name: 'deleting a file keeps its bytes unless a purge was asked for',
    package: 'api',
    file: 'src/routes/files.ts',
    find: "  return query.purge === 'true';",
    replace: '  return true;',
    tests: ['tests/e2e/softDelete.test.ts'],
    testName: 'keeps every version and every stored object when a file is deleted',
  },
  {
    name: 'a deleted file refuses a new version instead of quietly gaining one',
    package: 'api',
    file: 'src/services/files.ts',
    find: '  if (file.deleted_at !== null) {',
    replace: '  if (false) {',
    tests: ['tests/e2e/softDelete.test.ts'],
    testName: 'refuses a new version for a deleted file',
  },
  {
    name: 'a purge reaches the tombstones inside the folder it is reclaiming',
    package: 'api',
    file: 'src/routes/files.ts',
    // The mutation ADDS a predicate rather than removing one. Every listing
    // filters tombstones, so adding it here is the plausible mistake -- and it
    // orphans every tombstoned file's objects with nothing left naming them.
    find: "            .where('file.id', 'in', fileIds)",
    replace:
      "            .where('file.id', 'in', fileIds)\n            .where('file.deleted_at', 'is', null)",
    tests: ['tests/e2e/softDelete.test.ts'],
    testName: 'purging a folder reclaims the objects of a tombstone inside it',
  },
  {
    name: 'a purge walks through the deleted folders inside what it is reclaiming',
    package: 'api',
    file: 'src/routes/files.ts',
    // The same plausible edit as the guard above, one construct higher, and it
    // leaks strictly more: the cascade still takes every row under a deleted
    // folder, so their objects are left with nothing naming them at all.
    find: "              .select(['f.id as id'])",
    replace:
      "              .select(['f.id as id'])\n              .where('f.deleted_at', 'is', null)",
    tests: ['tests/e2e/softDelete.test.ts'],
    testName: 'purging a folder reclaims the objects of a tombstone inside it',
  },
  {
    name: 'a superseded deleted listing cannot overwrite a newer one',
    package: 'web',
    file: 'src/lib/deleted.svelte.ts',
    find: '      if (generation !== this.#generation) return;',
    replace: '      if (false) return;',
    tests: ['src/lib/deleted.svelte.test.ts'],
    testName: 'discards a response that a newer request has already superseded',
    runner: 'web',
  },
  {
    // The one that looks right in every screenshot and is wrong on every sheet.
    // A three-column grid makes it worse: the set of positions a backing page
    // occupies is symmetric either way, so only the pairing gives it away.
    name: 'a backing page is mirrored, so a back lands behind its own front',
    package: 'api',
    file: 'packages/shared/src/print.ts',
    root: true,
    find: '  return { index: row * grid.columns + (grid.columns - 1 - column), rotate_180: false };',
    replace: '  return { index: row * grid.columns + column, rotate_180: false };',
    tests: ['src/print.test.ts'],
    testName: 'puts a long-edge back where the paper flip lands it',
    runner: 'shared',
  },
  {
    // Six cards a sheet on minis, and nothing about the output looks wrong --
    // it is simply a third more paper than it needed to be.
    name: 'the packing tries the card turned as well as upright',
    package: 'api',
    file: 'packages/shared/src/print.ts',
    root: true,
    find: '  const rotated = turned.columns * turned.rows > upright.columns * upright.rows;',
    replace: '  const rotated = false;',
    tests: ['src/print.test.ts'],
    testName: 'fits mini cards 18 to a US Letter sheet',
    runner: 'shared',
  },
  {
    // Asserting access where a mutation needs write is the defect convention 4
    // names, and it reads as a plausible copy from the route above it.
    name: 'replacing a deck’s cards asserts write, not merely access',
    package: 'api',
    file: 'src/routes/decks.ts',
    find:
      "    const access = await assertDeckAccess(c, deckId, 'write');\n" +
      "    const { cards } = c.req.valid('json')",
    replace:
      "    const access = await assertDeckAccess(c, deckId, 'read');\n" +
      "    const { cards } = c.req.valid('json')",
    tests: ['tests/e2e/decks.test.ts'],
    testName: 'refuses a viewer editing the cards with 403',
  },
  {
    // Carrying the removal row forward reads as the card still standing, which
    // is the one thing an as-of view exists to get right.
    name: 'the deck as it stood stops carrying a card the import removed',
    package: 'api',
    file: 'src/services/deckImport.ts',
    find: "where r.rn = 1 and r.outcome <> 'removed'",
    replace: 'where r.rn = 1',
    tests: ['tests/e2e/deckImport.test.ts'],
    testName: 'leaves out a card that import removed',
  },
  {
    // An open run has not removed anything yet, so answering it at all hands
    // back a deck that never existed.
    name: 'an import still running is refused rather than half-answered',
    package: 'api',
    file: 'src/services/deckImport.ts',
    find: "  if (row.status === 'open') {",
    replace: '  if (false) {',
    tests: ['tests/e2e/deckImport.test.ts'],
    testName: 'refuses a run that is still open',
  },
  {
    // Without the deck in the path a hand-edited URL renders another deck's
    // history under this deck's name. One helper scopes both reads of a run,
    // so either of them catches this.
    name: 'a run from another deck is not readable through this deck',
    package: 'api',
    file: 'src/services/deckImport.ts',
    find:
      "    .where('import_run.import_id', '=', importId)\n" +
      '    .executeTakeFirst();\n' +
      "  if (!row) throw new AppError(404, 'Import run not found');",
    replace:
      '    .executeTakeFirst();\n' + "  if (!row) throw new AppError(404, 'Import run not found');",
    tests: ['tests/e2e/deckImport.test.ts'],
    testName: 'answers 404 for a run belonging to another deck',
  },
  {
    // An abandoned run writes real ledger rows: its pages landed and its
    // versions are on disk. The deck was handed none of it, and this predicate
    // is the whole of what keeps those rows out of the answer -- the honesty of
    // the view rests on it and nothing else asserts it.
    name: 'an abandoned run is left out of the deck as it stood',
    package: 'api',
    file: 'src/services/deckImport.ts',
    find: "where r.status = 'finished' and (r.started_at, r.id) <= (a.started_at, a.id)",
    replace: 'where (r.started_at, r.id) <= (a.started_at, a.id)',
    tests: ['tests/e2e/deckImport.test.ts'],
    testName: 'leaves out an abandoned run inside a later window',
  },
  {
    // The route answers 404 for a deck that is not bound at all, which is not
    // the same 404 as a deck nobody may read.
    name: 'a deck with no import is offered a binding, not an error',
    package: 'web',
    file: 'src/lib/deckImports.svelte.ts',
    find: '      if (caught instanceof ApiError && caught.status === 404) {',
    replace: '      if (false) {',
    tests: ['src/lib/deckImports.svelte.test.ts'],
    testName: 'treats a 404 from the binding route as a deck that is not bound yet',
    runner: 'web',
  },
  {
    name: 'a superseded binding load does not overwrite a newer one',
    package: 'web',
    file: 'src/lib/deckImports.svelte.ts',
    find: '      if (generation !== this.#bindingGeneration) return;',
    replace: '      if (false) return;',
    tests: ['src/lib/deckImports.svelte.test.ts'],
    testName: 'discards a binding response that a newer request has already superseded',
    runner: 'web',
  },
  {
    // Info-ZIP and ditto both write a longer extra field locally than they
    // record centrally, and the bytes that puts the read out by inflate fine.
    name: "an entry's data offset comes from its own local header",
    package: 'web',
    file: 'src/lib/canva/zip.ts',
    find: '          view.getUint16(localOffset + 28, true);',
    replace: '          extraLength;',
    tests: ['src/lib/canva/zip.test.ts'],
    testName: "reads each entry's data offset from its own local header",
    runner: 'web',
  },
  {
    // Passing the export's own numbers through leaves a gap where a page was
    // deleted in Canva, and the manifest is refused with a 422 nothing on the
    // screen can act on.
    name: "an export's pages are renumbered 1..n, not passed through",
    package: 'web',
    file: 'src/lib/canva/pages.ts',
    find: '    page_number: index + 1,',
    replace: '    page_number: page.parsedNumber ?? index + 1,',
    tests: ['src/lib/canva/pages.test.ts'],
    testName: 'numbers the pages 1..n even when the export skips one',
    runner: 'web',
  },
  {
    // Inflating first pays for the very bytes being refused, and the size was
    // in hand before any of them were read.
    name: 'an oversized page is refused on the size the directory declares',
    package: 'web',
    file: 'src/lib/canva/pages.ts',
    find: '    if (entry.uncompressedSize > MAX_UPLOAD_BYTES) {',
    replace: '    if (false) {',
    tests: ['src/lib/canva/pages.test.ts'],
    testName: 'refuses an oversized page on the size the directory declares',
    runner: 'web',
  },
  {
    // Version-needed 4.6 and 6.3 are BZIP2 and LZMA, so leaving the method to
    // the ZIP64 test refuses those archives for a format they do not use.
    name: 'a method this cannot read is named rather than blamed on ZIP64',
    package: 'web',
    file: 'src/lib/canva/zip.ts',
    find: '    if (method !== 0 && method !== 8) {',
    replace: '    if (false) {',
    tests: ['src/lib/canva/zip.test.ts'],
    testName: 'names the compression method for the versions APPNOTE gives',
    runner: 'web',
  },
  {
    // Bytes that disagree with the directory are a page's artwork, versioned
    // over a real card by the import that follows.
    name: "an entry's bytes are reconciled against the directory",
    package: 'web',
    file: 'src/lib/canva/zip.ts',
    find: '        return reconciled(name, out, uncompressedSize, crc);',
    replace: '        return out;',
    tests: ['src/lib/canva/zip.test.ts'],
    testName: 'refuses an entry whose bytes do not match the central directory checksum',
    runner: 'web',
  },
  {
    // The binding was read before this session's run existed, so the only id
    // that can discard a plan nobody confirmed is the one the store holds.
    name: 'a plan can be discarded by whoever just made it',
    package: 'web',
    file: 'src/routes/DeckImport.svelte',
    find: '  const openRunId = $derived(startedRunId ?? knownRunId);',
    replace: '  const openRunId = $derived(knownRunId);',
    tests: ['src/routes/DeckImport.svelte.test.ts'],
    testName: 'discards the run this session has just started',
    runner: 'web',
  },
  {
    // One store, and an unconfirmed plan deliberately outlives the screen.
    name: 'a plan belongs to the deck it was made for',
    package: 'web',
    file: 'src/routes/DeckImport.svelte',
    find: '  const plan = $derived(ours ? deckImports.plan : null);',
    replace: '  const plan = $derived(deckImports.plan);',
    tests: ['src/routes/DeckImport.svelte.test.ts'],
    testName: 'does not offer one deck',
    runner: 'web',
  },
  {
    name: 'the store refuses to upload a plan made for another deck',
    package: 'web',
    file: 'src/lib/deckImports.svelte.ts',
    find: '    if (!run || !pages || this.runDeckId !== deckId) return;',
    replace: '    if (!run || !pages) return;',
    tests: ['src/lib/deckImports.svelte.test.ts'],
    testName: 'will not confirm a plan that belongs to another deck',
    runner: 'web',
  },
  {
    // Choosing a file mid-upload starts a second run and abandons the first.
    name: 'the export picker is gone while pages are going up',
    package: 'web',
    file: 'src/routes/DeckImport.svelte',
    find: '      {#if binding?.folder_id && !openRunId && !busy}',
    replace: '      {#if binding?.folder_id}',
    tests: ['src/routes/DeckImport.svelte.test.ts'],
    testName: 'takes the export picker away while pages are going up',
    runner: 'web',
  },
  {
    // The run numbers its pages from the manifest it opened with, so another
    // export resumed into it writes its artwork onto these cards.
    name: 'a resume is checked against the export the run named',
    package: 'web',
    file: 'src/lib/deckImports.svelte.ts',
    find: '      if (label !== null && normalizeSourceLabel(label) !== offered) {',
    replace: '      if (false) {',
    tests: ['src/lib/deckImports.svelte.test.ts'],
    testName: 'refuses to resume a run with an export that is not the one it started from',
    runner: 'web',
  },
  {
    // The label the server kept went through a trim and a cut to the title
    // limit, and the file offered to resume has been through neither.
    name: 'a resume compares two labels the server would store',
    package: 'web',
    file: 'src/lib/deckImports.svelte.ts',
    find: '      if (label !== null && normalizeSourceLabel(label) !== offered) {',
    replace: '      if (label !== null && label !== file.name) {',
    tests: ['src/lib/deckImports.svelte.test.ts'],
    testName: 'resumes when the run holds this file',
    runner: 'web',
  },
  {
    name: 'the manifest is sent the label the server will keep',
    package: 'web',
    file: 'src/lib/deckImports.svelte.ts',
    find: '            source_label: normalizeSourceLabel(this.#file?.name),',
    replace: '            source_label: this.#file?.name ?? null,',
    tests: ['src/lib/deckImports.svelte.test.ts'],
    testName: 'starts the run with the label the server will keep',
    runner: 'web',
  },
  {
    // Canva names an export after the design it came from, so the name alone
    // cannot tell a re-export after an edit from the file the run opened with.
    name: 'a resume is checked against the shape of the export too',
    package: 'web',
    file: 'src/lib/deckImports.svelte.ts',
    find: '    if (pages.length !== planned) {',
    replace: '    if (false) {',
    tests: ['src/lib/deckImports.svelte.test.ts'],
    testName: 'refuses to resume an export that is not the length',
    runner: 'web',
  },
  {
    // The screens are not remounted when the deck in the URL changes, so the
    // binding left in the store is read as the next deck's, open run and all.
    name: 'a binding belongs to the deck it was read for',
    package: 'web',
    file: 'src/lib/deckImports.svelte.ts',
    find:
      '    this.bindingDeckId = null;\n' +
      '    this.binding = null;\n' +
      '    this.folderName = null;\n',
    replace: '',
    tests: ['src/lib/deckImports.svelte.test.ts'],
    testName: 'drops the previous deck',
    runner: 'web',
  },
  {
    // Unbinding is not a way out either: the refusal asks about the cards, not
    // about the old folder id, so it stands after an unbind.
    name: 'the folder copy names only a remedy that exists',
    package: 'web',
    file: 'src/routes/DeckImport.svelte',
    find: '                them there, otherwise choosing another folder is refused.',
    replace:
      '                them there, or unbind this deck, otherwise choosing another folder is\n' +
      '                refused.',
    tests: ['src/routes/DeckImport.svelte.test.ts'],
    testName: 'offers no remedy the screen has no control for',
    runner: 'web',
  },
  {
    // The count alone cannot say which card is about to be tombstoned, and the
    // plan is the only place that can be seen coming.
    name: 'the plan names the card each page overwrites',
    package: 'web',
    file: 'src/routes/DeckImport.svelte',
    find: '                {:else if page.name}',
    replace: '                {:else if false}',
    tests: ['src/routes/DeckImport.svelte.test.ts'],
    testName: 'names the card each page will write a new version of',
    runner: 'web',
  },
  {
    // One event per imported page, project-wide: a fifty-page run reloads the
    // deck fifty times for everyone sitting on it.
    name: 'a burst of realtime events reloads the deck once',
    package: 'web',
    file: 'src/routes/Deck.svelte',
    find:
      '      if (pending) clearTimeout(pending);\n' +
      '      pending = setTimeout(() => {\n' +
      '        pending = null;\n' +
      '        void decks.refreshDeck().catch(() => {});\n' +
      '      }, REFRESH_COALESCE_MS);',
    replace: '      void decks.refreshDeck().catch(() => {});',
    tests: ['src/routes/Deck.svelte.test.ts'],
    testName: 'reloads the deck once for a burst of realtime events',
    runner: 'web',
  },
  {
    // Reading the prop straight is what every other component here does, and it
    // looks like a needless indirection to take out. Inside a keyed each the
    // prop is a getter over the row, so the effect subscribes to the row and one
    // copy count edit blanks and re-reads every image in the deck.
    name: 'an identity-only prop change does not re-read a thumbnail',
    package: 'web',
    file: 'src/components/Thumbnail.svelte',
    find: '    const id = currentFileId;',
    replace: '    const id = fileId;',
    tests: ['src/routes/Deck.svelte.test.ts'],
    testName: 'does not reload the thumbnails when a copy count changes',
    runner: 'web',
  },
];
