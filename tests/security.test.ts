import { test, expect, beforeAll } from "bun:test";
import { readFile } from "node:fs/promises";
import { client } from "../scripts/local";
const m = client(),
  a = client(),
  b = client(),
  anon = client();
let oid: string, tid: string, aid: string, bid: string;
beforeAll(async () => {
  const users = JSON.parse(
    await readFile(new URL("../.local/accounts.json", import.meta.url), "utf8"),
  );
  for (const [i, c] of [m, a, b].entries()) {
    const { error } = await c.auth.signInWithPassword(users[i]);
    if (error) throw error;
  }
  aid = users[1].id;
  bid = users[2].id;
  const o = await m.rpc("save_object", {
    p_id: null,
    p_name: "Проверка " + Date.now(),
    p_address: "Тестовый адрес",
  });
  if (o.error) throw o.error;
  oid = o.data;
  const t = await m.rpc("save_task", {
    p_id: null,
    p_title: "Проверка защиты",
    p_description: "",
    p_object_id: oid,
    p_assignee_id: aid,
  });
  if (t.error) throw t.error;
  tid = t.data;
});
test("чужие задачи, история и объекты закрыты", async () => {
  for (const [table, column, id] of [
    ["tasks", "id", tid],
    ["task_history", "task_id", tid],
    ["objects", "id", oid],
  ]) {
    const r = await b.from(table).select("*").eq(column, id);
    expect(r.error).toBeNull();
    expect(r.data).toEqual([]);
  }
});
test("анонимный пользователь не читает данные и не вызывает запись", async () => {
  expect((await anon.from("tasks").select("*")).error).not.toBeNull();
  expect(
    (await anon.rpc("archive_record", { p_kind: "task", p_id: tid })).error,
  ).not.toBeNull();
});
test("роль, поля задачи и история защищены от прямой записи", async () => {
  expect(
    (await a.from("profiles").update({ role: "manager" }).eq("id", aid)).error,
  ).not.toBeNull();
  expect(
    (
      await a
        .from("tasks")
        .update({ status: "accepted", author_id: bid })
        .eq("id", tid)
    ).error,
  ).not.toBeNull();
  for (const c of [m, a]) {
    expect(
      (
        await c
          .from("task_history")
          .insert({
            task_id: tid,
            actor_id: aid,
            actor_name: "Подделка",
            to_status: "accepted",
          })
      ).error,
    ).not.toBeNull();
    expect(
      (
        await c
          .from("task_history")
          .update({ comment: "Подделка" })
          .eq("task_id", tid)
      ).error,
    ).not.toBeNull();
    expect(
      (await c.from("task_history").delete().eq("task_id", tid)).error,
    ).not.toBeNull();
  }
});
test("чужой исполнитель не меняет статус; исполнитель не редактирует поля", async () => {
  expect(
    (await b.rpc("transition_task", { p_id: tid, p_status: "in_progress" }))
      .error,
  ).not.toBeNull();
  expect(
    (
      await a.rpc("save_task", {
        p_id: tid,
        p_title: "Взлом",
        p_description: "",
        p_object_id: oid,
        p_assignee_id: aid,
      })
    ).error,
  ).not.toBeNull();
});
test("цикл, комментарий и параллельная отправка", async () => {
  expect(
    (await a.rpc("transition_task", { p_id: tid, p_status: "accepted" })).error,
  ).not.toBeNull();
  const results = await Promise.all([
    a.rpc("transition_task", { p_id: tid, p_status: "in_progress" }),
    a.rpc("transition_task", { p_id: tid, p_status: "in_progress" }),
  ]);
  expect(results.filter((r) => !r.error)).toHaveLength(1);
  expect(
    (await a.rpc("transition_task", { p_id: tid, p_status: "review" })).error,
  ).toBeNull();
  expect(
    (
      await m.rpc("transition_task", {
        p_id: tid,
        p_status: "rework",
        p_comment: "  ",
      })
    ).error,
  ).not.toBeNull();
  expect(
    (
      await m.rpc("transition_task", {
        p_id: tid,
        p_status: "rework",
        p_comment: "Исправить крепление",
      })
    ).error,
  ).toBeNull();
  expect(
    (await a.rpc("transition_task", { p_id: tid, p_status: "in_progress" }))
      .error,
  ).toBeNull();
  expect(
    (await a.rpc("transition_task", { p_id: tid, p_status: "review" })).error,
  ).toBeNull();
  expect(
    (await m.rpc("transition_task", { p_id: tid, p_status: "accepted" })).error,
  ).toBeNull();
  const h = await a
    .from("task_history")
    .select("*")
    .eq("task_id", tid)
    .order("id");
  expect(h.error).toBeNull();
  expect(h.data?.map((v) => v.to_status)).toEqual([
    "new",
    "in_progress",
    "review",
    "rework",
    "in_progress",
    "review",
    "accepted",
  ]);
  expect(h.data?.[3].comment).toBe("Исправить крепление");
});
test("переназначение отзывает доступ; удаление сохраняет историю", async () => {
  expect(
    (
      await m.rpc("save_task", {
        p_id: tid,
        p_title: "Переназначена",
        p_description: "",
        p_object_id: oid,
        p_assignee_id: bid,
      })
    ).error,
  ).toBeNull();
  expect((await a.from("tasks").select("*").eq("id", tid)).data).toEqual([]);
  expect(
    (await a.from("task_history").select("*").eq("task_id", tid)).data,
  ).toEqual([]);
  expect(
    (await b.from("tasks").select("*").eq("id", tid)).data?.[0].status,
  ).toBe("accepted");
  expect(
    (await m.rpc("archive_record", { p_kind: "object", p_id: oid })).error,
  ).toBeNull();
  expect((await b.from("tasks").select("*").eq("id", tid)).data).toEqual([]);
  expect(
    (await m.from("task_history").select("*").eq("task_id", tid)).data,
  ).toHaveLength(7);
});
test("публичная регистрация отключена", async () => {
  expect(
    (
      await anon.auth.signUp({
        email: "blocked@example.com",
        password: "RandomTestPassword123!",
      })
    ).error,
  ).not.toBeNull();
});
