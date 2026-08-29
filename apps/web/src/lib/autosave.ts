// How long a dial-in waits before it saves.
//
// Long enough that dragging a slider is one request rather than sixty, short
// enough that letting go and closing the tab still saves. One constant rather
// than one per store, because a card's settings and a component's are the same
// kind of editing and a person moving between them should not meet two
// different delays.
export const SAVE_DELAY_MS = 600;
