import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @mlightcad/libredwg-web (see src/lib/dxf/dwg.ts) is an Emscripten/WASM
  // module that locates its .wasm binary at runtime via `import.meta.url`
  // + a real filesystem read (fs.readFileSync), the same way it would in
  // any plain Node process. Left to Next's webpack bundler, that .wasm
  // import gets treated as a *client* static asset instead: it's emitted
  // to .next/static/media/libredwg-web.<hash>.wasm (a public URL path,
  // meant for the browser to fetch) and the server code ends up trying to
  // fs.readFileSync() that same "/_next/static/..." URL string as if it
  // were a real path on disk — which it isn't in the deployed Function,
  // so every DWG upload fails with an ENOENT for that path. Listing the
  // package here excludes it from webpack bundling for server code
  // entirely; Node's own require()/import() resolves it directly from
  // node_modules at runtime instead, where the .wasm file actually is.
  serverExternalPackages: ["@mlightcad/libredwg-web"],
  experimental: {
    serverActions: {
      // Next.js defaults Server Action request bodies to 1MB, which is why
      // any file upload above ~1MB (a real DXF drawing, a phone photo, a
      // multi-page PDF) was failing with "Body exceeded 1 MB limit."
      //
      // The real ceiling is lower than it looks, though: Vercel's own
      // platform enforces a hard 4.5MB request body limit on every
      // Function — Server Action or API route — on every plan, and it
      // cannot be raised by any framework config. So 4mb here is the
      // practical maximum, not an arbitrary choice: it removes Next's
      // artificial 1MB ceiling while staying safely under Vercel's real
      // one (see storage.ts MAX_FILE_SIZE_BYTES, which was lowered to
      // match — it used to claim 25MB, which never actually worked on
      // Vercel). Uploads bigger than a few MB need a different approach
      // entirely (uploading straight to R2 from the browser via a
      // presigned URL, bypassing Vercel's function body altogether) —
      // ask before building that if this limit becomes a real problem.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
