import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { client } from "../scripts/local";
test("все запрещённые переходы отклоняются базой", async () => {
  const users = JSON.parse(
    await readFile(new URL("../.local/accounts.json", import.meta.url), "utf8"),
  );
  const manager = client();
  await manager.auth.signInWithPassword(users[0]);
  const { data: tasks, error } = await manager
    .from("tasks")
    .select("*")
    .is("deleted_at", null);
  if (error) throw error;
  for (const status of ["new", "in_progress", "review", "accepted", "rework"]) {
    const task = tasks!.find((t) => t.status === status);
    expect(task).toBeDefined();
    for (const role of ["manager", "executor"]) {
      const c = client();
      const account =
        role === "manager"
          ? users[0]
          : users.find((u: { id: string }) => u.id === task.assignee_id);
      await c.auth.signInWithPassword(account);
      const allowed =
        role === "manager"
          ? status === "review"
            ? ["accepted", "rework"]
            : []
          : status === "new" || status === "rework"
            ? ["in_progress"]
            : status === "in_progress"
              ? ["review"]
              : [];
      for (const target of [
        "new",
        "in_progress",
        "review",
        "accepted",
        "rework",
        "unknown",
      ]) {
        if (allowed.includes(target)) continue;
        expect(
          (
            await c.rpc("transition_task", {
              p_id: task.id,
              p_status: target,
              p_comment: "Проверка",
            })
          ).error,
        ).not.toBeNull();
      }
    }
  }
});
