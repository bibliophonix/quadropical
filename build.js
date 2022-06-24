require("esbuild").build({
    entryPoints: ["src/index.js"],
    bundle: true,
    minify: true,
    outfile: "dist/js/main.js",
}).catch(() => process.exit(1))
