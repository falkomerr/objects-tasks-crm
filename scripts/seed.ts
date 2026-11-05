import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { admin, client, localUrl, publicKey } from "./local";
import { join } from "node:path";
const file = join(import.meta.dir, "../.local/accounts.json");
await mkdir(join(import.meta.dir, "../.local"), { recursive: true });
type Account = {
  email: string;
  password: string;
  id: string;
  role: string;
  name: string;
};
let accounts: Account[] = [];
try {
  accounts = JSON.parse(await readFile(file, "utf8"));
} catch {
  accounts = [];
}
if (accounts.length < 3) {
  for (const [index, role] of ["manager", "executor", "executor"].entries()) {
    if (index < accounts.length) continue;
    const email = "demo" + index + "@crm.local";
    const password = randomBytes(18).toString("base64url");
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    accounts.push({
      id: data.user.id,
      email,
      password,
      role,
      name: [
        "Анна · руководитель",
        "Иван · исполнитель",
        "Ольга · исполнитель",
      ][index],
    });
    await writeFile(file, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  }
}
for (const a of accounts) {
  const { error } = await admin
    .from("profiles")
    .upsert({ id: a.id, name: a.name, role: a.role });
  if (error) throw error;
}
await writeFile(
  join(import.meta.dir, "../.env.local"),
  "VITE_SUPABASE_URL=" +
    localUrl +
    "\nVITE_SUPABASE_ANON_KEY=" +
    publicKey +
    "\n",
);
const m = client();
const { error } = await m.auth.signInWithPassword(accounts[0]);
if (error) throw error;
const { data: existing, error: readError } = await m
  .from("objects")
  .select("id");
if (readError) throw readError;
if (!existing?.length) {
  for (let i = 0; i < 3; i++) {
    const { data: oid, error } = await m.rpc("save_object", {
      p_id: null,
      p_name: ["ЖК «Сосновый»", "Школа № 12", "Склад «Север»"][i],
      p_address: ["Сосновая ул., 8", "Мира ул., 12", "Промышленная ул., 4"][i],
    });
    if (error) throw error;
    for (let j = 0; j < 5; j++) {
      const a = accounts[(j % 2) + 1];
      const e = client();
      await e.auth.signInWithPassword(a);
      const { data: tid, error } = await m.rpc("save_task", {
        p_id: null,
        p_title: [
          "Подготовить площадку",
          "Смонтировать опалубку",
          "Проверить проводку",
          "Принять материалы",
          "Устранить замечания",
        ][j],
        p_description: "Проверить результат и передать руководителю.",
        p_object_id: oid,
        p_assignee_id: a.id,
      });
      if (error) throw error;
      async function move(
        c: ReturnType<typeof client>,
        s: string,
        comment: string | null = null,
      ) {
        const { error } = await c.rpc("transition_task", {
          p_id: tid,
          p_status: s,
          p_comment: comment,
        });
        if (error) throw error;
      }
      if (j > 0) await move(e, "in_progress");
      if (j > 1) await move(e, "review");
      if (j === 3) await move(m, "accepted");
      if (j === 4) await move(m, "rework", "Проверьте соответствие проекту");
    }
  }
}
console.log(
  "Демоданные готовы. Учётные записи находятся в .local/accounts.json (не коммитить).",
);
