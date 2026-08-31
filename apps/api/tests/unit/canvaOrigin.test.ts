import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.ts';

const CANVA_APP_ID = process.env.CANVA_APP_ID;
const CORS_ORIGINS = process.env.CORS_ORIGINS;

afterEach(() => {
  if (CANVA_APP_ID === undefined) delete process.env.CANVA_APP_ID;
  else process.env.CANVA_APP_ID = CANVA_APP_ID;
  if (CORS_ORIGINS === undefined) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = CORS_ORIGINS;
});

describe('where the Canva app is served from', () => {
  // Read off a running app rather than documented anywhere: app id AAHOGNr0B1M
  // was served from https://app-aahognr0b1m.canva-apps.com. One observation, so
  // the derivation is written down where it can be corrected rather than spread
  // across a config file and a middleware.
  it('is the app id lower cased, under canva-apps.com', () => {
    process.env.CANVA_APP_ID = 'AAHOGEdIZTQ';
    expect(env.canva.appOrigin).toBe('https://app-aahogediztq.canva-apps.com');
  });

  it('is nothing at all when no app is configured', () => {
    delete process.env.CANVA_APP_ID;
    expect(env.canva.appOrigin).toBeUndefined();
  });

  it('reaches CORS without being configured a second time', () => {
    process.env.CANVA_APP_ID = 'AAHOGEdIZTQ';
    process.env.CORS_ORIGINS = 'https://tools.threepeaksgames.com';

    // The deployment names only the web origin. Listing the app's as well would
    // be a second answer to which app this is, free to disagree with the id the
    // token audience is checked against.
    expect(env.corsOrigins).toEqual([
      'https://tools.threepeaksgames.com',
      'https://app-aahogediztq.canva-apps.com',
    ]);
  });

  it('lets configuration name an origin the pattern does not predict', () => {
    process.env.CANVA_APP_ID = 'AAHOGEdIZTQ';
    process.env.CORS_ORIGINS = 'https://app-aahogediztq.canva-apps.com';

    // Union, not replacement, and no duplicate: if Canva ever moves where an
    // app is served from, the fix is one entry here rather than a release.
    expect(env.corsOrigins).toEqual(['https://app-aahogediztq.canva-apps.com']);
  });

  it('adds nothing when no app is configured', () => {
    delete process.env.CANVA_APP_ID;
    process.env.CORS_ORIGINS = 'https://tools.threepeaksgames.com';
    expect(env.corsOrigins).toEqual(['https://tools.threepeaksgames.com']);
  });
});
