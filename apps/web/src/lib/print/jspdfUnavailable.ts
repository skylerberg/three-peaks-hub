// Stands in for the three packages jsPDF reaches for and this app does not use.
//
// `doc.html()` pulls html2canvas and dompurify, and `doc.addSvgAsImage()` pulls
// canvg. The print sheets call neither: artwork arrives as bytes and an SVG is
// rasterised through a canvas in `images.ts`, at the size it will be printed.
// All three are optional dependencies, and `ignoredOptionalDependencies` in
// pnpm-workspace.yaml keeps them out of the tree -- html2canvas alone is larger
// than everything the print screen actually loads.
//
// The import sites are dynamic, so nothing here is evaluated unless one of those
// methods is called. But Vite resolves a bare specifier at transform time
// whether or not the branch runs, so without a module at these names the whole
// bundle fails to build. This is that module, and it says what to do rather than
// failing as a missing package two layers down.
const unavailable = () => {
  throw new Error(
    'jsPDF asked for html2canvas, canvg or dompurify. This app deliberately does not ' +
      'install them — see ignoredOptionalDependencies in pnpm-workspace.yaml. Rasterise ' +
      'through a canvas with lib/print/images.ts instead, or install the package and drop ' +
      'the alias in vite.config.ts.'
  );
};

export default unavailable;
