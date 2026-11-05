export const labels: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  review: "На проверке",
  accepted: "Принята",
  rework: "На доработке",
};
export function actions(role: string, status: string): string[] {
  if (role === "manager")
    return status === "review" ? ["accepted", "rework"] : [];
  if (role !== "executor") return [];
  return status === "new" || status === "rework"
    ? ["in_progress"]
    : status === "in_progress"
      ? ["review"]
      : [];
}
