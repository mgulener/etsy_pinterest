import { spawn } from "node:child_process";
import { resolve } from "node:path";

const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3107"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: `--require=${JSON.stringify(resolve("tests/browser/mock-services.cjs"))}`,
    NEXT_PUBLIC_SUPABASE_URL: "https://pinterest-description-db.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-only-service-key",
    SESSION_SECRET: "pinterest-description-browser-test-only",
    AUTOMATION_USER_ID: "browser-test-owner"
  }
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", code => process.exit(code ?? 0));
