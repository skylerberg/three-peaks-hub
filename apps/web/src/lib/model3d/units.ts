// glTF's unit is the metre, and every viewer and every importer assumes it. The
// settings are in millimetres because that is what a manufacturer quotes, so
// this factor is the whole conversion -- applied when geometry is built, never
// afterwards by scaling a node.
export const MM = 0.001;
