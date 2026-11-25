import { strict as assert } from "node:assert";
import { test } from "node:test";
import { sidebarComponent } from "./components.js";

test("la barra lateral no duplica la carpeta Tots els elements", () => {
  const html = sidebarComponent({
    entries: [],
    activeFolderId: "",
    folders: [
      {
        id: "default",
        name: "Tots els elements",
        icon: "ShieldCheck",
        color: "#2563eb",
      },
      { id: "favorits", name: "Favorits", icon: "Star", color: "#fbbf24" },
    ],
  });

  assert.equal((html.match(/Tots els elements/g) || []).length, 1);
  assert.ok(!html.includes('data-folder="default"'));
  assert.ok(html.includes('data-folder="favorits"'));
});
