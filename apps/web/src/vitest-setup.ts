import '@testing-library/jest-dom/vitest';
// Side-effecting, and it goes first: it stubs fetch, Request and the storage
// objects, and a module that reads any of them at import time gets the real
// ones if it loads first.
import './api/testUtils.ts';
