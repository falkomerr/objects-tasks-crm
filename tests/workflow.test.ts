import { test, expect } from "bun:test";
import { actions } from "../src/workflow";
test("исполнитель начинает новую задачу", () =>
  expect(actions("executor", "new")).toEqual(["in_progress"]));
test("постановщик принимает или возвращает результат", () =>
  expect(actions("manager", "review")).toEqual(["accepted", "rework"]));
test("нет переходов из принятой задачи", () =>
  expect(actions("manager", "accepted")).toEqual([]));
test("постановщик не начинает работу исполнителя", () =>
  expect(actions("manager", "new")).toEqual([]));
