// AUTO-GENERATED FROM apps/api's OpenAPI spec. DO NOT EDIT.
// Regenerate with: pnpm run generate
//
// Committed on purpose: apps/web must type-check, build and run on a fresh
// clone with no database and no API process, and the diff is what makes a
// breaking change to the API surface visible in review.
export interface paths {
  '/api/auth/signup': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Create an account
     * @description Creates an account and returns a session token.
     */
    post: operations['postApiAuthSignup'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Sign in
     * @description Exchanges an email and password for a session token.
     */
    post: operations['postApiAuthLogin'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/forgot-password': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Request a password reset
     * @description Sends a reset link to an address that has an account. Answers 404 for one that does not.
     */
    post: operations['postApiAuthForgotPassword'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/reset-password': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Set a new password from a reset link
     * @description Consumes a reset token. Rotating alternative_id is what makes the link single-use; sessions are deliberately left signed in.
     */
    post: operations['postApiAuthResetPassword'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/me': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * The signed-in account
     * @description Returns the account the presented token belongs to.
     */
    get: operations['getApiAuthMe'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Sign out
     * @description Revokes the session the request was authenticated with.
     */
    post: operations['postApiAuthLogout'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/sessions': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List active sessions
     * @description Every unexpired session for this account, newest first.
     */
    get: operations['getApiAuthSessions'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/sessions/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * Revoke a session
     * @description Signs out one session. Revoking the current one is allowed.
     */
    delete: operations['deleteApiAuthSessionsById'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/auth/change-password': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Change password
     * @description Requires the current password. Leaves every session signed in, including this one, so no replacement token is issued.
     */
    post: operations['postApiAuthChangePassword'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/projects': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List projects
     * @description Every project the caller created or is a member of, with their role on each.
     */
    get: operations['getApiProjects'];
    put?: never;
    /**
     * Create a project
     * @description The creator is an implicit editor and is never stored as a member row.
     */
    post: operations['postApiProjects'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/projects/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Get a project
     * @description Answers 404 rather than 403 for a project the caller cannot see.
     */
    get: operations['getApiProjectsById'];
    put?: never;
    post?: never;
    /**
     * Delete a project
     * @description Owner only. Cascades to members, folders and file rows.
     */
    delete: operations['deleteApiProjectsById'];
    options?: never;
    head?: never;
    /**
     * Update a project
     * @description Editors only. A viewer who can read the project gets 403.
     */
    patch: operations['patchApiProjectsById'];
    trace?: never;
  };
  '/api/projects/{id}/members': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List members
     * @description The creator is listed first and is always an editor.
     */
    get: operations['getApiProjectsByIdMembers'];
    /**
     * Add or change a member
     * @description Owner only. The creator cannot be added as a member of their own project.
     */
    put: operations['putApiProjectsByIdMembers'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/projects/{id}/members/{userId}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * Remove a member
     * @description The owner may remove anyone; a member may remove only themselves.
     */
    delete: operations['deleteApiProjectsByIdMembersByUserId'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/files/directory': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * List one directory
     * @description The folders and files directly inside one directory, plus the breadcrumb to it and the project storage total. One request per screen.
     */
    get: operations['getApiFilesDirectory'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/files/folders': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Create a folder
     * @description Names are unique within a directory, compared case-insensitively.
     */
    post: operations['postApiFilesFolders'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/files/folders/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /**
     * Delete a folder
     * @description Cascades to everything inside it. Stored objects go after commit.
     */
    delete: operations['deleteApiFilesFoldersById'];
    options?: never;
    head?: never;
    /**
     * Rename or move a folder
     * @description A move that would put a folder inside itself is refused.
     */
    patch: operations['patchApiFilesFoldersById'];
    trace?: never;
  };
  '/api/files/upload': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /**
     * Upload a file
     * @description The request body is the file itself; metadata travels in the query string. Serializing the bytes into JSON would read the whole file into memory on both ends.
     */
    post: operations['postApiFilesUpload'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/files/{id}/download': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /**
     * Download a file
     * @description Served through the API rather than from a public bucket, because who may read the bytes depends on project membership.
     */
    get: operations['getApiFilesByIdDownload'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/files/{id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    /** Delete a file */
    delete: operations['deleteApiFilesById'];
    options?: never;
    head?: never;
    /** Rename or move a file */
    patch: operations['patchApiFilesById'];
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    AuthResponse: {
      expires_at: string;
      token: string;
      user: {
        email: string;
        email_verified: boolean;
        id: string;
        name: string;
      };
    };
    DirectoryListing: {
      breadcrumb: {
        created_at: string;
        id: string;
        name: string;
        parent_id: string | null;
        project_id: string;
        updated_at: string;
      }[];
      files: {
        byte_size: number;
        content_type: string;
        created_at: string;
        filename: string;
        folder_id: string | null;
        id: string;
        image_height: number | null;
        image_width: number | null;
        project_id: string;
        updated_at: string;
        uploaded_by: string;
      }[];
      folder: {
        created_at: string;
        id: string;
        name: string;
        parent_id: string | null;
        project_id: string;
        updated_at: string;
      } | null;
      folders: {
        created_at: string;
        id: string;
        name: string;
        parent_id: string | null;
        project_id: string;
        updated_at: string;
      }[];
      project_id: string;
      storage_quota_bytes: number;
      storage_used_bytes: number;
    };
    Email: string;
    File: {
      byte_size: number;
      content_type: string;
      created_at: string;
      filename: string;
      folder_id: string | null;
      id: string;
      image_height: number | null;
      image_width: number | null;
      project_id: string;
      updated_at: string;
      uploaded_by: string;
    };
    Folder: {
      created_at: string;
      id: string;
      name: string;
      parent_id: string | null;
      project_id: string;
      updated_at: string;
    };
    Password: string;
    Project: {
      created_at: string;
      created_by: string;
      description: string | null;
      id: string;
      name: string;
      /** @enum {unknown} */
      role: 'editor' | 'viewer';
      updated_at: string;
    };
    ProjectList: {
      projects: {
        created_at: string;
        created_by: string;
        description: string | null;
        id: string;
        name: string;
        /** @enum {unknown} */
        role: 'editor' | 'viewer';
        updated_at: string;
      }[];
    };
    ProjectMemberList: {
      members: {
        email: string;
        is_creator: boolean;
        name: string;
        /** @enum {unknown} */
        role: 'editor' | 'viewer';
        user_id: string;
      }[];
    };
    SessionList: {
      sessions: {
        created_at: string;
        current: boolean;
        expires_at: string;
        id: string;
        user_agent: string | null;
      }[];
    };
    User: {
      email: string;
      email_verified: boolean;
      id: string;
      name: string;
    };
    /**
     * Format: uuid
     * @description a UUID
     */
    Uuid: string | '00000000-0000-0000-0000-000000000000' | 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  postApiAuthSignup: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          email: components['schemas']['Email'];
          name: string;
          password: components['schemas']['Password'];
          id?: components['schemas']['Uuid'];
        };
      };
    };
    responses: {
      /** @description Account created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResponse'];
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  postApiAuthLogin: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          email: components['schemas']['Email'];
          password: components['schemas']['Password'];
        };
      };
    };
    responses: {
      /** @description Signed in */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResponse'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  postApiAuthForgotPassword: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          email: components['schemas']['Email'];
        };
      };
    };
    responses: {
      /** @description Reset email enqueued */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  postApiAuthResetPassword: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          password: components['schemas']['Password'];
          token: string;
        };
      };
    };
    responses: {
      /** @description Password changed */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  getApiAuthMe: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The account */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['User'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  postApiAuthLogout: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Signed out */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  getApiAuthSessions: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Active sessions */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionList'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  deleteApiAuthSessionsById: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Revoked */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  postApiAuthChangePassword: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          current_password: string;
          new_password: components['schemas']['Password'];
        };
      };
    };
    responses: {
      /** @description Password changed */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  getApiProjects: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Projects */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ProjectList'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  postApiProjects: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          name: string;
          description?: string | unknown | null;
          id?: components['schemas']['Uuid'];
        };
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Project'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  getApiProjectsById: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The project */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Project'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  deleteApiProjectsById: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  patchApiProjectsById: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          description?: string | unknown | null;
          name?: string;
        };
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Project'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  getApiProjectsByIdMembers: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Members */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ProjectMemberList'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  putApiProjectsByIdMembers: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          /** Format: email */
          email: string;
          /** @enum {unknown} */
          role: 'editor' | 'viewer';
        };
      };
    };
    responses: {
      /** @description Member set */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  deleteApiProjectsByIdMembersByUserId: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
        userId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Removed */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  getApiFilesDirectory: {
    parameters: {
      query: {
        /** @description a UUID */
        project_id:
          string | '00000000-0000-0000-0000-000000000000' | 'ffffffff-ffff-ffff-ffff-ffffffffffff';
        /** @description a UUID */
        folder_id?:
          string | '00000000-0000-0000-0000-000000000000' | 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Directory listing */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DirectoryListing'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  postApiFilesFolders: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          name: string;
          project_id: components['schemas']['Uuid'];
          id?: components['schemas']['Uuid'];
          parent_id?:
            | string
            | '00000000-0000-0000-0000-000000000000'
            | 'ffffffff-ffff-ffff-ffff-ffffffffffff'
            | null;
        };
      };
    };
    responses: {
      /** @description Created */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Folder'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  deleteApiFilesFoldersById: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  patchApiFilesFoldersById: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          name?: string;
          parent_id?:
            | string
            | '00000000-0000-0000-0000-000000000000'
            | 'ffffffff-ffff-ffff-ffff-ffffffffffff'
            | null;
        };
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Folder'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  postApiFilesUpload: {
    parameters: {
      query: {
        filename: string;
        /** @description a UUID */
        project_id:
          string | '00000000-0000-0000-0000-000000000000' | 'ffffffff-ffff-ffff-ffff-ffffffffffff';
        /** @description a UUID */
        folder_id?:
          string | '00000000-0000-0000-0000-000000000000' | 'ffffffff-ffff-ffff-ffff-ffffffffffff';
        /** @description a UUID */
        id?:
          string | '00000000-0000-0000-0000-000000000000' | 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Uploaded */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['File'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Payload too large */
      413: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  getApiFilesByIdDownload: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description The file bytes */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  deleteApiFilesById: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
  patchApiFilesById: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
          filename?: string;
          folder_id?:
            | string
            | '00000000-0000-0000-0000-000000000000'
            | 'ffffffff-ffff-ffff-ffff-ffffffffffff'
            | null;
        };
      };
    };
    responses: {
      /** @description Updated */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['File'];
        };
      };
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
      /** @description Validation failed */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            details: {
              message: string;
              path: string;
            }[];
            error: string;
          };
        };
      };
      /** @description Internal server error */
      500: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            error: string;
          };
        };
      };
    };
  };
}
