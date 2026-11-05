import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
const status = JSON.parse(
  execFileSync("bunx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
  }),
);
export const localUrl = status.API_URL as string;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(localUrl))
  throw Error("Только локальная среда");
export const publicKey = status.ANON_KEY as string;
export const admin = createClient(localUrl, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
export const client = () =>
  createClient(localUrl, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
