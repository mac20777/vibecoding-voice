import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const VALID_VOICE_MODES = new Set(["normal", "todo"]);

const TODO_FILE_VERSION = 1;
const DEFAULT_TODO_ITEMS = [
  "示例：按住 BOOT 说“添加计划 喝水”",
  "示例：UP/DN 移动选中项",
  "示例：短按 BOOT 完成或删除当前计划",
  "示例：双击 UP 切换 Todo / Live"
];

function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(value) {
  return collapseWhitespace(value);
}

function normalizePositiveInteger(value) {
  const numeric = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function cloneItem(item) {
  return {
    id: item.id,
    title: item.title,
    completed: Boolean(item.completed),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function sanitizePersistedState(rawState) {
  const source = rawState && typeof rawState === "object" ? rawState : {};
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items = rawItems
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const title = normalizeTitle(item.title);
      if (!title) {
        return null;
      }

      const createdAt = collapseWhitespace(item.createdAt) || new Date().toISOString();
      const updatedAt = collapseWhitespace(item.updatedAt) || createdAt;

      return {
        id: collapseWhitespace(item.id) || randomUUID(),
        title,
        completed: Boolean(item.completed),
        createdAt,
        updatedAt
      };
    })
    .filter(Boolean);

  const selectedIndex = Number.isInteger(source.selectedIndex)
    ? Math.min(Math.max(source.selectedIndex, 0), Math.max(items.length - 1, 0))
    : items.length > 0
      ? 0
      : -1;

  return {
    version: TODO_FILE_VERSION,
    items,
    selectedIndex: items.length === 0 ? -1 : selectedIndex
  };
}

function createDefaultTodoState() {
  const now = new Date().toISOString();
  return {
    version: TODO_FILE_VERSION,
    items: DEFAULT_TODO_ITEMS.map((title) => ({
      id: randomUUID(),
      title,
      completed: false,
      createdAt: now,
      updatedAt: now
    })),
    selectedIndex: 0
  };
}

function writeJsonAtomic(filePath, payload) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, payload, "utf8");
  fs.renameSync(tempPath, filePath);
}

export function parseTodoVoiceCommand(input) {
  const text = collapseWhitespace(input);
  if (!text) {
    return {
      ok: false,
      message: "请说：查看计划、添加计划 XXX、删除计划 2、修改计划 2 改成 XXX"
    };
  }

  if (/^(?:查看|显示|列出)(?:计划|待办|todo)(?:列表)?$/iu.test(text)) {
    return { ok: true, action: "list" };
  }

  if (/^(?:(?:删除|删掉|清空)(?:全部|所有|全都)?(?:计划|待办|todo)(?:列表)?|(?:全部|全都|所有)(?:删除|删掉))$/iu.test(text)) {
    return { ok: true, action: "clear" };
  }

  const createMatch = text.match(/^(?:添加(?:一个)?|新增|增加|加一个)(?:计划|待办|todo)?\s*(.*)$/iu);
  if (createMatch) {
    const title = normalizeTitle(createMatch[1]);
    return title
      ? { ok: true, action: "create", text: title }
      : { ok: false, message: "请说：添加计划 XXX" };
  }

  const deleteMatch = text.match(/^(?:删除|删掉)(?:计划|待办|todo)\s*(?:第)?([0-9]+)(?:项)?$/iu);
  if (deleteMatch) {
    return { ok: true, action: "delete", index: Number.parseInt(deleteMatch[1], 10) };
  }
  if (/^(?:删除|删掉)(?:计划|待办|todo)$/iu.test(text)) {
    return { ok: false, message: "请说：删除计划 2" };
  }

  const updateMatch = text.match(
    /^(?:修改|更新)(?:计划|待办|todo)\s*(?:第)?([0-9]+)(?:项)?\s*(?:改成|为|成)\s*(.*)$/iu
  );
  if (updateMatch) {
    const title = normalizeTitle(updateMatch[2]);
    return title
      ? {
          ok: true,
          action: "update",
          index: Number.parseInt(updateMatch[1], 10),
          text: title
        }
      : { ok: false, message: "请说：修改计划 2 改成 XXX" };
  }
  if (/^(?:修改|更新)(?:计划|待办|todo)\s*(?:第)?[0-9]+(?:项)?$/iu.test(text)) {
    return { ok: false, message: "请说：修改计划 2 改成 XXX" };
  }

  const completeMatch = text.match(/^(?:完成|勾选)(?:计划|待办|todo)\s*(?:第)?([0-9]+)(?:项)?$/iu);
  if (completeMatch) {
    return {
      ok: true,
      action: "toggle",
      index: Number.parseInt(completeMatch[1], 10),
      completed: true
    };
  }

  const uncompleteMatch = text.match(
    /^(?:取消完成|取消勾选)(?:计划|待办|todo)\s*(?:第)?([0-9]+)(?:项)?$/iu
  );
  if (uncompleteMatch) {
    return {
      ok: true,
      action: "toggle",
      index: Number.parseInt(uncompleteMatch[1], 10),
      completed: false
    };
  }

  return {
    ok: false,
    message: "请说：查看计划、添加计划 XXX、删除计划 2、修改计划 2 改成 XXX"
  };
}

export class TodoService {
  constructor({ storagePath, seedDefaultItems = true }) {
    this.storagePath = storagePath;
    this.seedDefaultItems = seedDefaultItems;
    this.lastActionText = "";
    const loaded = this.#loadState();
    this.items = loaded.items;
    this.selectedIndex = loaded.selectedIndex;
    if (loaded.seeded && this.storagePath) {
      this.#persist();
    }
  }

  getSnapshot() {
    return {
      items: this.items.map(cloneItem),
      selectedIndex: this.selectedIndex,
      lastActionText: this.lastActionText
    };
  }

  runCommand(command) {
    const action = collapseWhitespace(command?.action).toLowerCase();
    switch (action) {
      case "list":
        return this.list();
      case "create":
        return this.create(command?.text);
      case "update":
        return this.update(command?.index, command?.text, command?.id);
      case "delete":
        return this.delete(command?.index, command?.id);
      case "clear":
        return this.clear();
      case "toggle":
        return this.toggle(command?.index, command?.completed, command?.id);
      case "select_next":
        return this.selectNext();
      case "select_prev":
        return this.selectPrev();
      default:
        throw new Error(`unsupported_todo_action:${action || "unknown"}`);
    }
  }

  list() {
    const count = this.items.length;
    this.lastActionText = count === 0 ? "暂无计划" : `共有 ${count} 条计划`;
    return {
      ok: true,
      action: "list",
      changed: false,
      message: this.lastActionText,
      snapshot: this.getSnapshot()
    };
  }

  create(text) {
    const title = normalizeTitle(text);
    if (!title) {
      throw new Error("todo_title_required");
    }

    const now = new Date().toISOString();
    this.items.push({
      id: randomUUID(),
      title,
      completed: false,
      createdAt: now,
      updatedAt: now
    });
    this.selectedIndex = this.items.length - 1;
    this.lastActionText = `已添加计划 ${this.items.length}`;
    this.#persist();
    return {
      ok: true,
      action: "create",
      changed: true,
      message: this.lastActionText,
      snapshot: this.getSnapshot()
    };
  }

  update(index, text, id) {
    const resolvedIndex = this.#resolveIndex(index, id);
    const title = normalizeTitle(text);
    if (!title) {
      throw new Error("todo_title_required");
    }

    const item = this.items[resolvedIndex];
    item.title = title;
    item.updatedAt = new Date().toISOString();
    this.selectedIndex = resolvedIndex;
    this.lastActionText = `已更新计划 ${resolvedIndex + 1}`;
    this.#persist();
    return {
      ok: true,
      action: "update",
      changed: true,
      message: this.lastActionText,
      snapshot: this.getSnapshot()
    };
  }

  delete(index, id) {
    const resolvedIndex = this.#resolveIndex(index, id);
    this.items.splice(resolvedIndex, 1);
    if (this.items.length === 0) {
      this.selectedIndex = -1;
    } else {
      this.selectedIndex = Math.min(resolvedIndex, this.items.length - 1);
    }
    this.lastActionText = `已删除计划 ${resolvedIndex + 1}`;
    this.#persist();
    return {
      ok: true,
      action: "delete",
      changed: true,
      message: this.lastActionText,
      snapshot: this.getSnapshot()
    };
  }

  clear() {
    const count = this.items.length;
    this.items = [];
    this.selectedIndex = -1;
    this.lastActionText = count === 0 ? "暂无计划可删除" : `已删除全部 ${count} 条计划`;
    this.#persist();
    return {
      ok: true,
      action: "clear",
      changed: count > 0,
      message: this.lastActionText,
      snapshot: this.getSnapshot()
    };
  }

  toggle(index, completed, id) {
    const resolvedIndex = this.#resolveIndex(index, id);
    const item = this.items[resolvedIndex];
    item.completed = typeof completed === "boolean" ? completed : !item.completed;
    item.updatedAt = new Date().toISOString();
    this.selectedIndex = resolvedIndex;
    this.lastActionText = item.completed
      ? `已完成计划 ${resolvedIndex + 1}`
      : `已恢复计划 ${resolvedIndex + 1}`;
    this.#persist();
    return {
      ok: true,
      action: "toggle",
      changed: true,
      message: this.lastActionText,
      snapshot: this.getSnapshot()
    };
  }

  selectNext() {
    if (this.items.length === 0) {
      this.lastActionText = "暂无计划";
      return {
        ok: true,
        action: "select_next",
        changed: false,
        message: this.lastActionText,
        snapshot: this.getSnapshot()
      };
    }

    const current = this.selectedIndex < 0
      ? 0
      : Math.min(Math.max(this.selectedIndex, 0), this.items.length - 1);
    const nextIndex = (current + 1) % this.items.length;
    const changed = nextIndex !== this.selectedIndex;
    this.selectedIndex = nextIndex;
    this.lastActionText = `当前计划 ${this.selectedIndex + 1}`;
    this.#persist();
    return {
      ok: true,
      action: "select_next",
      changed,
      message: this.lastActionText,
      snapshot: this.getSnapshot()
    };
  }

  selectPrev() {
    if (this.items.length === 0) {
      this.lastActionText = "暂无计划";
      return {
        ok: true,
        action: "select_prev",
        changed: false,
        message: this.lastActionText,
        snapshot: this.getSnapshot()
      };
    }

    const current = this.selectedIndex < 0
      ? 0
      : Math.min(Math.max(this.selectedIndex, 0), this.items.length - 1);
    const nextIndex = (current - 1 + this.items.length) % this.items.length;
    const changed = nextIndex !== this.selectedIndex;
    this.selectedIndex = nextIndex;
    this.lastActionText = `当前计划 ${this.selectedIndex + 1}`;
    this.#persist();
    return {
      ok: true,
      action: "select_prev",
      changed,
      message: this.lastActionText,
      snapshot: this.getSnapshot()
    };
  }

  #loadState() {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) {
      return this.seedDefaultItems
        ? { ...createDefaultTodoState(), seeded: true }
        : sanitizePersistedState(null);
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.storagePath, "utf8"));
      return sanitizePersistedState(parsed);
    } catch {
      this.#backupCorruptFile();
      return sanitizePersistedState(null);
    }
  }

  #backupCorruptFile() {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) {
      return;
    }

    const backupPath = `${this.storagePath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(this.storagePath, backupPath);
    } catch {
      // ignore
    }
  }

  #persist() {
    writeJsonAtomic(
      this.storagePath,
      JSON.stringify(
        {
          version: TODO_FILE_VERSION,
          selectedIndex: this.selectedIndex,
          items: this.items.map(cloneItem)
        },
        null,
        2
      )
    );
  }

  #resolveIndex(index, id) {
    if (this.items.length === 0) {
      throw new Error("todo_empty");
    }

    const normalizedId = collapseWhitespace(id);
    if (normalizedId) {
      const resolvedIndex = this.items.findIndex((item) => item.id === normalizedId);
      if (resolvedIndex === -1) {
        throw new Error("todo_item_not_found");
      }
      return resolvedIndex;
    }

    if (index === undefined || index === null || String(index).trim() === "") {
      if (this.selectedIndex < 0 || this.selectedIndex >= this.items.length) {
        throw new Error("todo_index_required");
      }
      return this.selectedIndex;
    }

    const numericIndex = normalizePositiveInteger(index);
    if (numericIndex == null) {
      throw new Error("todo_index_invalid");
    }

    const resolvedIndex = numericIndex - 1;
    if (resolvedIndex < 0 || resolvedIndex >= this.items.length) {
      throw new Error("todo_index_out_of_range");
    }
    return resolvedIndex;
  }
}

export function createTodoService(options) {
  return new TodoService(options);
}
