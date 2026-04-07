import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createTodoService } from "../src/todo-service.mjs";

function createTempTodoPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-todo-"));
  return {
    dir,
    filePath: path.join(dir, "todo-list.json")
  };
}

test("TodoService supports CRUD and selection", () => {
  const { dir, filePath } = createTempTodoPath();
  try {
    const service = createTodoService({ storagePath: filePath, seedDefaultItems: false });

    assert.equal(service.getSnapshot().items.length, 0);

    service.runCommand({ action: "create", text: "Buy milk" });
    service.runCommand({ action: "create", text: "Ship release" });
    let snapshot = service.getSnapshot();
    const firstId = snapshot.items[0].id;
    const secondId = snapshot.items[1].id;
    assert.equal(snapshot.items.length, 2);
    assert.equal(snapshot.selectedIndex, 1);
    assert.equal(snapshot.items[1].title, "Ship release");

    service.runCommand({ action: "select_prev" });
    snapshot = service.getSnapshot();
    assert.equal(snapshot.selectedIndex, 0);

    service.runCommand({ action: "toggle", id: firstId });
    snapshot = service.getSnapshot();
    assert.equal(snapshot.items[0].completed, true);

    service.runCommand({ action: "update", id: secondId, text: "Ship stable release" });
    snapshot = service.getSnapshot();
    assert.equal(snapshot.items[1].title, "Ship stable release");

    service.runCommand({ action: "delete", id: firstId });
    snapshot = service.getSnapshot();
    assert.equal(snapshot.items.length, 1);
    assert.equal(snapshot.items[0].title, "Ship stable release");
    assert.equal(snapshot.selectedIndex, 0);

    const clearResult = service.runCommand({ action: "clear" });
    snapshot = service.getSnapshot();
    assert.equal(clearResult.action, "clear");
    assert.equal(snapshot.items.length, 0);
    assert.equal(snapshot.selectedIndex, -1);

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(persisted.items.length, 0);
    assert.equal(persisted.selectedIndex, -1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("TodoService backs up corrupt files and starts empty", () => {
  const { dir, filePath } = createTempTodoPath();
  try {
    fs.writeFileSync(filePath, "{not-json", "utf8");
    const service = createTodoService({ storagePath: filePath, seedDefaultItems: false });
    const snapshot = service.getSnapshot();
    assert.equal(snapshot.items.length, 0);
    assert.equal(snapshot.selectedIndex, -1);

    const backup = fs.readdirSync(dir).find((name) => name.startsWith("todo-list.json.corrupt-"));
    assert.ok(backup);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("TodoService seeds onboarding examples when storage is missing", () => {
  const { dir, filePath } = createTempTodoPath();
  try {
    const service = createTodoService({ storagePath: filePath });
    const snapshot = service.getSnapshot();

    assert.equal(snapshot.items.length, 4);
    assert.equal(snapshot.selectedIndex, 0);
    assert.match(snapshot.items[0].title, /按住 BOOT/);
    assert.match(snapshot.items[1].title, /UP\/DN/);
    assert.match(snapshot.items[2].title, /短按 BOOT/);
    assert.match(snapshot.items[3].title, /双击 UP/);
    assert.equal(fs.existsSync(filePath), true);

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(persisted.items.length, 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
