import { cors } from 'hono/cors';
import { env } from '../config/env.ts';

// In production the load balancer serves the SPA and the API on one origin, so
// this matters only in development — where the two are on different ports.
export const corsMiddleware = cors({
  origin: (origin) => (env.corsOrigins.includes(origin) ? origin : null),
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
  credentials: true,
  maxAge: 600,
});
