import { defineConfig } from "vite";
import { execSync } from "child_process";

// Fase 5a (H14): inyectar el SHA del commit en el bundle para el bloqueo
// por versión contra serverBuild.
let sha = "";
try { sha = execSync("git rev-parse HEAD").toString().trim(); } catch {}
export default defineConfig({
  define: { "import.meta.env.VITE_BUILD_SHA": JSON.stringify(sha) },
});
