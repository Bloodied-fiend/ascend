// Bundle party.mjs -> dist/index.mjs and zip it (what the Neon Functions deploy API expects).
//   node build.mjs   -> dist/party.zip, dist/party.zip.b64
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
await build({ entryPoints: ["party.mjs"], bundle: true, platform: "node", target: "node24", format: "esm", minify: true, outfile: "dist/index.mjs" });
execFileSync("powershell", ["-NoProfile", "-Command", "Compress-Archive -Path dist/index.mjs -DestinationPath dist/party.zip -Force"]);
writeFileSync("dist/party.zip.b64", readFileSync("dist/party.zip").toString("base64"));
console.log("built", readFileSync("dist/party.zip").length, "bytes");
