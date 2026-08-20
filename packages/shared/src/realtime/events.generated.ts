// AUTO-GENERATED FROM apps/api's realtime document. DO NOT EDIT.
// Regenerate with: pnpm run generate

export type RealtimeEventType =
  | 'file_deleted'
  | 'file_updated'
  | 'file_uploaded'
  | 'folder_created'
  | 'folder_deleted'
  | 'folder_updated'
  | 'members_changed'
  | 'project_deleted'
  | 'project_updated';

export type RealtimeEvent =
  | {
      type: 'file_deleted';
      project_id: string;
      file_id: string;
      actor_user_id: string;
    }
  | {
      type: 'file_updated';
      project_id: string;
      file_id: string;
      actor_user_id: string;
    }
  | {
      type: 'file_uploaded';
      project_id: string;
      file_id: string;
      actor_user_id: string;
    }
  | {
      type: 'folder_created';
      project_id: string;
      folder_id: string;
      actor_user_id: string;
    }
  | {
      type: 'folder_deleted';
      project_id: string;
      folder_id: string;
      actor_user_id: string;
    }
  | {
      type: 'folder_updated';
      project_id: string;
      folder_id: string;
      actor_user_id: string;
    }
  | {
      type: 'members_changed';
      project_id: string;
      actor_user_id: string;
    }
  | {
      type: 'project_deleted';
      project_id: string;
      actor_user_id: string;
    }
  | {
      type: 'project_updated';
      project_id: string;
      actor_user_id: string;
    };

// The set a client has to route on. A code added at a close site but not in the
// server's table reaches no client at all.
export type RealtimeCloseCode = 4401 | 4429;
