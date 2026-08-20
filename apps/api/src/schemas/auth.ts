import { type } from 'arktype';
import { email, password, stringWithLength, uuid } from './common.ts';

export const signupRequestSchema = type({
  // Client-supplied so the UI can act optimistically; a duplicate answers 409.
  'id?': uuid,
  email,
  password,
  name: stringWithLength(1, 100),
});

export const loginRequestSchema = type({ email, password });

export const userSchema = type({
  id: 'string',
  email: 'string',
  name: 'string',
  email_verified: 'boolean',
});

export const authResponseSchema = type({
  token: 'string',
  expires_at: 'string',
  user: userSchema,
});

export const sessionSchema = type({
  id: 'string',
  user_agent: 'string | null',
  created_at: 'string',
  expires_at: 'string',
  current: 'boolean',
});

export const sessionListSchema = type({ sessions: sessionSchema.array() });

export const forgotPasswordRequestSchema = type({ email });
export const resetPasswordRequestSchema = type({ token: 'string', password });
export const changePasswordRequestSchema = type({
  current_password: 'string',
  new_password: password,
});
