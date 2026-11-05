import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type Session } from "@supabase/supabase-js";
import { actions, labels } from "./workflow";
import "./style.css";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const db = url && key ? createClient(url, key) : null;
type Profile = { id: string; name: string; role: string };
type Obj = { id: string; name: string; address: string };
type Task = {
  id: string;
  title: string;
  description: string;
  object_id: string;
  assignee_id: string;
  status: string;
  author_id: string;
  created_at: string;
};
type History = {
  id: number;
  actor_name: string;
  from_status: string | null;
  to_status: string;
  comment: string | null;
  created_at: string;
};
const stamp = (s: string) => new Date(s).toLocaleString("ru-RU");
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState("");
  useEffect(() => {
    if (!db) {
      setReady(true);
      return;
    }
    let active = true;
    db.auth.getSession().then(({ data, error }) => {
      if (active) {
        setSession(data.session);
        setAuthError(error?.message ?? "");
        setReady(true);
      }
    });
    const { data } = db.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setReady(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  if (!db)
    return (
      <main className="login">
        <h1>Контур</h1>
        <p>
          Настройте подключение к Supabase в .env.local по инструкции README.
        </p>
      </main>
    );
  if (!ready) return <main>Загрузка сессии…</main>;
  if (session)
    return <Workspace key={session.user.id} userId={session.user.id} />;
  return <Login initialError={authError} />;
}
function Login({ initialError }: { initialError: string }) {
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <span className="eyebrow">СТРОИТЕЛЬСТВО / УПРАВЛЕНИЕ</span>
      <h1>
        Контур<span>.</span>
      </h1>
      <p>Объекты, задачи и понятный порядок работы.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            const { error } = await db!.auth.signInWithPassword({
              email: String(f.get("email")),
              password: String(f.get("password")),
            });
            if (error) throw error;
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Пароль
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button disabled={busy}>{busy ? "Вход…" : "Войти"}</button>
      </form>
    </main>
  );
}
function Workspace({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [objects, setObjects] = useState<Obj[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [view, setView] = useState("objects");
  const [objectId, setObjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<"object" | "task" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [comment, setComment] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const responses = await Promise.all([
          db!.from("profiles").select("*"),
          db!.from("objects").select("*").is("deleted_at", null).order("name"),
          db!
            .from("tasks")
            .select("*")
            .is("deleted_at", null)
            .order("created_at", { ascending: false }),
        ]);
        for (const r of responses) if (r.error) throw r.error;
        if (!active) return;
        const p = responses[0].data as Profile[];
        setProfile(p.find((p) => p.id === userId) ?? null);
        setPeople(p);
        setObjects(responses[1].data as Obj[]);
        setTasks(responses[2].data as Task[]);
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, revision]);
  useEffect(() => {
    let active = true;
    setHistory([]);
    setComment("");
    if (taskId)
      db!
        .from("task_history")
        .select("*")
        .eq("task_id", taskId)
        .order("id")
        .then(({ data, error }) => {
          if (active) {
            if (error) setError(error.message);
            else setHistory(data ?? []);
          }
        });
    return () => {
      active = false;
    };
  }, [taskId, revision]);
  const manager = profile?.role === "manager";
  const object = objects.find((o) => o.id === objectId);
  const task = tasks.find((t) => t.id === taskId);
  async function mutate(
    fn: () => PromiseLike<{ error: { message: string } | null }>,
  ) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      const { error } = await fn();
      if (error) throw error;
      setRevision((n) => n + 1);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function navigate(v: string, oid = "", tid = "") {
    setView(v);
    setObjectId(oid);
    setTaskId(tid);
    setEditing(null);
    setError("");
  }
  const selected =
    editing === "object"
      ? objects.find((o) => o.id === editingId)
      : tasks.find((t) => t.id === editingId);
  return (
    <div className="shell">
      <aside>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("objects");
          }}
        >
          Контур<span>.</span>
        </a>
        <p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p>
        <nav>
          <button
            className={
              view === "objects" || view === "object" ? "active" : "secondary"
            }
            onClick={() => navigate("objects")}
          >
            Объекты <span>{objects.length}</span>
          </button>
          {!manager && (
            <button
              className={view === "mine" ? "active" : "secondary"}
              onClick={() => navigate("mine")}
            >
              Мои задачи
            </button>
          )}
        </nav>
        <footer>
          {profile?.name ?? "Профиль не настроен"}
          <small>{manager ? "Постановщик" : "Исполнитель"}</small>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void mutate(() => db!.auth.signOut())}
          >
            Выйти
          </button>
        </footer>
      </aside>
      <main>
        <header>
          <span className="eyebrow">ОБЪЕКТЫ И ЗАДАЧИ</span>
          <span>{new Date().toLocaleDateString("ru-RU")}</span>
        </header>
        {error && (
          <p role="alert" className="error">
            {error}{" "}
            <button
              className="secondary"
              onClick={() => setRevision((n) => n + 1)}
            >
              Повторить
            </button>
          </p>
        )}
        {loading ? (
          <p role="status">Загрузка…</p>
        ) : !profile ? (
          <p>
            Для учётной записи не назначена роль. Обратитесь к администратору.
          </p>
        ) : (
          <>
            <div className="heading">
              <div>
                {view !== "objects" && (
                  <button
                    className="back"
                    onClick={() =>
                      navigate(
                        view === "task" ? "object" : "objects",
                        task?.object_id,
                      )
                    }
                  >
                    ← {view === "task" ? "К объекту" : "Все объекты"}
                  </button>
                )}
                <h1>
                  {view === "objects"
                    ? "Объекты"
                    : view === "mine"
                      ? "Мои задачи"
                      : view === "object"
                        ? (object?.name ?? "Объект недоступен")
                        : (task?.title ?? "Задача недоступна")}
                </h1>
                <p>
                  {view === "objects"
                    ? "Все стройки и текущие работы в одном месте."
                    : view === "object"
                      ? object?.address
                      : view === "mine"
                        ? "Ваши работы и их текущий статус."
                        : ""}
                </p>
              </div>
              {manager &&
                (view === "objects" || (view === "object" && object)) && (
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setEditing(view === "objects" ? "object" : "task");
                    }}
                  >
                    +{" "}
                    {view === "objects" ? "Добавить объект" : "Добавить задачу"}
                  </button>
                )}
            </div>
            {editing && (
              <section className="panel">
                <h2>
                  {editingId
                    ? "Редактирование"
                    : editing === "object"
                      ? "Новый объект"
                      : "Новая задача"}
                </h2>
                <form
                  key={editing + editingId}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    const ok = await mutate(() =>
                      editing === "object"
                        ? db!.rpc("save_object", {
                            p_id: editingId,
                            p_name: f.get("name"),
                            p_address: f.get("address"),
                          })
                        : db!.rpc("save_task", {
                            p_id: editingId,
                            p_title: f.get("title"),
                            p_description: f.get("description"),
                            p_object_id: f.get("object_id"),
                            p_assignee_id: f.get("assignee_id"),
                          }),
                    );
                    if (ok) setEditing(null);
                  }}
                >
                  {editing === "object" ? (
                    <>
                      <label>
                        Название
                        <input
                          name="name"
                          defaultValue={(selected as Obj)?.name}
                          required
                        />
                      </label>
                      <label>
                        Адрес
                        <input
                          name="address"
                          defaultValue={(selected as Obj)?.address}
                          required
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        Название
                        <input
                          name="title"
                          defaultValue={(selected as Task)?.title}
                          required
                        />
                      </label>
                      <label>
                        Описание
                        <textarea
                          name="description"
                          defaultValue={(selected as Task)?.description}
                        />
                      </label>
                      <label>
                        Объект
                        <select
                          aria-label="Объект"
                          name="object_id"
                          defaultValue={
                            (selected as Task)?.object_id ?? objectId
                          }
                          required
                        >
                          {objects.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Исполнитель
                        <select
                          aria-label="Исполнитель"
                          name="assignee_id"
                          defaultValue={(selected as Task)?.assignee_id ?? ""}
                          required
                        >
                          <option value="" disabled>
                            Выберите исполнителя
                          </option>
                          {people
                            .filter((p) => p.role === "executor")
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </>
                  )}
                  <div className="row">
                    <button disabled={busy}>Сохранить</button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      Отмена
                    </button>
                  </div>
                </form>
              </section>
            )}
            {view === "objects" && (
              <div className="grid">
                {objects.length === 0 && <p>Объектов пока нет.</p>}
                {objects.map((o, i) => (
                  <button
                    className="object-card"
                    key={o.id}
                    onClick={() => navigate("object", o.id)}
                  >
                    <small>ОБЪЕКТ {String(i + 1).padStart(2, "0")}</small>
                    <h2>{o.name}</h2>
                    <p>{o.address}</p>
                    <div className="card-bottom">
                      Задач: {tasks.filter((t) => t.object_id === o.id).length}
                      <span>Открыть ↗</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {(view === "object" || view === "mine") && (
              <>
                {manager && object && (
                  <div className="row tools">
                    <button
                      className="secondary"
                      onClick={() => {
                        setEditing("object");
                        setEditingId(object.id);
                      }}
                    >
                      Изменить объект
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          window.confirm(
                            "Удалить объект и все его задачи из рабочих списков? История сохранится.",
                          ) &&
                          (await mutate(() =>
                            db!.rpc("archive_record", {
                              p_kind: "object",
                              p_id: object.id,
                            }),
                          ))
                        )
                          navigate("objects");
                      }}
                    >
                      Удалить объект
                    </button>
                  </div>
                )}
                <section className="panel">
                  <h2>Задачи</h2>
                  {tasks.filter((t) =>
                    view === "mine"
                      ? t.assignee_id === userId
                      : t.object_id === objectId,
                  ).length === 0 && <p>Задач пока нет.</p>}
                  {tasks
                    .filter((t) =>
                      view === "mine"
                        ? t.assignee_id === userId
                        : t.object_id === objectId,
                    )
                    .map((t) => (
                      <button
                        key={t.id}
                        className="task-row"
                        onClick={() => navigate("task", t.object_id, t.id)}
                      >
                        <span>
                          {t.title}
                          <small>
                            {objects.find((o) => o.id === t.object_id)?.name}
                          </small>
                        </span>
                        <span className={"badge " + t.status}>
                          {labels[t.status]}
                        </span>
                        <span>→</span>
                      </button>
                    ))}
                </section>
              </>
            )}
            {view === "task" && task && (
              <div className="detail">
                <section className="panel">
                  <span className={"badge " + task.status}>
                    {labels[task.status]}
                  </span>
                  <h2>О задаче</h2>
                  <p className="description">
                    {task.description || "Описание не добавлено"}
                  </p>
                  <dl>
                    <dt>Объект</dt>
                    <dd>
                      {objects.find((o) => o.id === task.object_id)?.name}
                    </dd>
                    <dt>Исполнитель</dt>
                    <dd>
                      {people.find((p) => p.id === task.assignee_id)?.name ??
                        "Назначен"}
                    </dd>
                    <dt>Автор</dt>
                    <dd>
                      {people.find((p) => p.id === task.author_id)?.name ??
                        history[0]?.actor_name ??
                        "Постановщик"}
                    </dd>
                    <dt>Создана</dt>
                    <dd>{stamp(task.created_at)}</dd>
                  </dl>
                  {manager && (
                    <div className="row">
                      <button
                        className="secondary"
                        onClick={() => {
                          setEditing("task");
                          setEditingId(task.id);
                        }}
                      >
                        Редактировать
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            window.confirm(
                              "Удалить задачу из рабочего списка?",
                            ) &&
                            (await mutate(() =>
                              db!.rpc("archive_record", {
                                p_kind: "task",
                                p_id: task.id,
                              }),
                            ))
                          )
                            navigate("object", task.object_id);
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  )}
                  {manager && task.status === "review" && (
                    <label>
                      Комментарий к возврату
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="Что необходимо доработать"
                      />
                    </label>
                  )}
                  <div className="row">
                    {actions(profile.role, task.status).map((status) => (
                      <button
                        key={status}
                        disabled={
                          busy || (status === "rework" && !comment.trim())
                        }
                        onClick={() =>
                          void mutate(() =>
                            db!.rpc("transition_task", {
                              p_id: task.id,
                              p_status: status,
                              p_comment: comment || null,
                            }),
                          )
                        }
                      >
                        {status === "in_progress"
                          ? "Взять в работу"
                          : status === "review"
                            ? "Отправить на проверку"
                            : status === "accepted"
                              ? "Принять"
                              : "Вернуть на доработку"}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="panel">
                  <h2>История</h2>
                  <ol className="history">
                    {history.map((h) => (
                      <li key={h.id}>
                        <strong>
                          {h.from_status ? labels[h.from_status] + " → " : ""}
                          {labels[h.to_status]}
                        </strong>
                        <small>
                          {h.actor_name} · {stamp(h.created_at)}
                        </small>
                        {h.comment && <p>{h.comment}</p>}
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
