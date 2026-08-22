// A 4x4 opaque PNG. Two probes need something the API will accept as an image
// and neither cares what it looks like: one only needs the studio to open on it,
// and the other only needs a row that draws a thumbnail.
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR4nGP8//8/AzZgYsAB6CcBAFcMAwHKQGQCAAAAAElFTkSuQmCC',
  'base64'
);
