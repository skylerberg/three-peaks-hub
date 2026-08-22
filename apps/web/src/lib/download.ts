import { ApiError, authHeader } from '../api/client.ts';

// The bytes are behind the same bearer credential as every other API call, and
// a navigation the browser starts -- an <a download>, an <img src> -- carries no
// Authorization header at all. So the fetch happens here, with the header, and
// the browser is handed an object URL it already has the bytes for.
//
// A <button> rather than an anchor for the same reason the link action skips
// anchors carrying `download`: an anchor without one is intercepted as an
// in-app navigation.
export async function downloadFile(
  fileId: string,
  filename: string,
  version?: number
): Promise<void> {
  const query = version === undefined ? '' : `?version=${version}`;
  const response = await fetch(`/api/files/${fileId}/download${query}`, {
    headers: authHeader(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, body.error ?? `Download failed (${response.status})`);
  }

  const url = URL.createObjectURL(await response.blob());
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
