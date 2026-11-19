import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./content.js", import.meta.url), "utf8");

function createMockElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    innerHTML: "",
    textContent: "",
    children: [],
    childNodes: [],
    parentNode: null,
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      el.childNodes.push(child);
      return child;
    },
    append(...children) {
      children.forEach((child) => this.appendChild(child));
    },
    removeChild(child) {
      const index = el.children.indexOf(child);
      if (index !== -1) el.children.splice(index, 1);
      return child;
    },
    contains(other) {
      return other && other.parentNode === el;
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    getBoundingClientRect() {
      return {
        top: 0,
        left: 0,
        right: 300,
        bottom: 40,
        width: 300,
        height: 40,
      };
    },
    getClientRects() {
      return [{}];
    },
    attachShadow() {
      return createMockElement("shadow");
    },
  };
  return el;
}

const mockDocument = {
  createElement: (tag) => createMockElement(tag),
  addEventListener: () => {},
  body: createMockElement("body"),
  documentElement: createMockElement("html"),
  querySelector: () => null,
  querySelectorAll: () => [],
};

const mockWindow = {
  location: { hostname: "example.test" },
  innerHeight: 800,
  innerWidth: 1200,
  top: null,
  self: null,
  addEventListener: () => {},
};
mockWindow.top = mockWindow;
mockWindow.self = mockWindow;

const mockObserver = {
  observe() {},
  disconnect() {},
};

const context = vm.createContext({
  chrome: {
    runtime: {
      getURL: (path) => path,
      sendMessage: async () => ({}),
      onMessage: { addListener() {} },
    },
  },
  document: mockDocument,
  window: mockWindow,
  HTMLInputElement: function HTMLInputElement() {},
  Event: class Event {},
  setTimeout,
  requestAnimationFrame: (cb) => setTimeout(cb, 10),
  getComputedStyle: () => ({
    display: "block",
    visibility: "visible",
    opacity: "1",
    getPropertyValue: () => null,
  }),
  ResizeObserver: function () {
    return mockObserver;
  },
  MutationObserver: function () {
    return mockObserver;
  },
});
vm.runInContext(
  `${source}\n;globalThis.detect = findFormFields; globalThis.computeIconBox = computeIconBox; globalThis.isEligibleLoginField = isEligibleLoginField;`,
  context,
);

function input({
  type = "text",
  name = "",
  id = "",
  placeholder = "",
  autocomplete = "",
  visible = true,
  disabled = false,
  readOnly = false,
  form = {},
} = {}) {
  return {
    tagName: "INPUT",
    type,
    name,
    id,
    placeholder,
    autocomplete,
    disabled,
    readOnly,
    form,
    getClientRects: () => (visible ? [{}] : []),
    getAttribute: (name) => (name === "autocomplete" ? autocomplete : ""),
  };
}

function detect(inputs, options) {
  return context.detect({ querySelectorAll: () => inputs }, options);
}

test("detects an email and current-password login", () => {
  const form = {};
  const email = input({
    type: "email",
    name: "email",
    autocomplete: "email",
    form,
  });
  const password = input({
    type: "password",
    autocomplete: "current-password",
    form,
  });
  assert.equal(detect([email, password]).usernameEl, email);
  assert.equal(detect([email, password]).passwordEl, password);
});

test("detects username autocomplete and current-password", () => {
  const form = {};
  const username = input({
    name: "identifier",
    autocomplete: "username",
    form,
  });
  const password = input({
    type: "password",
    autocomplete: "current-password",
    form,
  });
  assert.equal(detect([username, password]).usernameEl, username);
  assert.equal(detect([username, password]).passwordEl, password);
});

test("does not autofill a signup form with new-password fields", () => {
  const form = {};
  const email = input({
    type: "email",
    name: "email",
    autocomplete: "email",
    form,
  });
  const newPassword = input({
    type: "password",
    autocomplete: "new-password",
    form,
  });
  const confirm = input({
    type: "password",
    name: "confirm",
    autocomplete: "new-password",
    form,
  });
  assert.deepEqual(
    { ...detect([email, newPassword, confirm]) },
    { usernameEl: null, passwordEl: null },
  );
  assert.equal(
    detect([email, newPassword, confirm], { includeNewPassword: true })
      .passwordEl,
    newPassword,
  );
});

test("selects the login form when a page also has a signup form", () => {
  const login = {};
  const signup = {};
  const newPassword = input({
    type: "password",
    autocomplete: "new-password",
    form: signup,
  });
  const username = input({
    name: "username",
    autocomplete: "username",
    form: login,
  });
  const password = input({
    type: "password",
    autocomplete: "current-password",
    form: login,
  });
  assert.equal(detect([newPassword, username, password]).usernameEl, username);
  assert.equal(detect([newPassword, username, password]).passwordEl, password);
});

test("detects the identifier on a two-step login page", () => {
  const email = input({ type: "email", name: "identifier" });
  assert.equal(detect([email]).usernameEl, email);
  assert.equal(detect([email]).passwordEl, null);
});

test("ignores hidden, disabled, readonly, search, and unrelated inputs", () => {
  const hidden = input({ name: "username", visible: false });
  const disabled = input({ name: "username", disabled: true });
  const readOnly = input({ name: "username", readOnly: true });
  const search = input({ type: "search", name: "search" });
  const unrelated = input({ name: "favorite_color" });
  const result = detect([hidden, disabled, readOnly, search, unrelated]);
  assert.equal(result.usernameEl, null);
  assert.equal(result.passwordEl, null);
});

// Tests for computeIconBox geometry
test("computeIconBox calculates correct size for large field (56px)", () => {
  const rect = {
    top: 0,
    left: 0,
    right: 300,
    bottom: 56,
    width: 300,
    height: 56,
  };
  const box = context.computeIconBox(rect);
  assert.equal(box.size, 40);
  assert.equal(box.margin, 8);
  assert.equal(box.top, 8);
  assert.equal(box.left, 252);
});

test("computeIconBox calculates correct size for medium field (40px)", () => {
  const rect = {
    top: 0,
    left: 0,
    right: 300,
    bottom: 40,
    width: 300,
    height: 40,
  };
  const box = context.computeIconBox(rect);
  assert.equal(box.size, 28);
  assert.equal(box.margin, 6);
  assert.equal(box.top, 6);
  assert.equal(box.left, 266);
});

test("computeIconBox calculates correct size for small field (28px)", () => {
  const rect = {
    top: 0,
    left: 0,
    right: 300,
    bottom: 28,
    width: 300,
    height: 28,
  };
  const box = context.computeIconBox(rect);
  // margin = clamp(4, 4.2, 8) = 4.2
  // size = clamp(18, 28-8.4, 40) = 19.6
  assert.ok(Math.abs(box.size - 19.6) < 1e-9);
  assert.ok(Math.abs(box.margin - 4.2) < 1e-9);
  assert.ok(Math.abs(box.top - 4.2) < 1e-9);
  assert.ok(Math.abs(box.left - 276.2) < 1e-9);
});

test("computeIconBox calculates correct size for tiny field (18px)", () => {
  const rect = {
    top: 0,
    left: 0,
    right: 300,
    bottom: 18,
    width: 300,
    height: 18,
  };
  const box = context.computeIconBox(rect);
  assert.equal(box.size, 18);
  assert.equal(box.margin, 4);
  assert.equal(box.top, 0);
  assert.equal(box.left, 278);
});

test("computeIconBox calculates correct size for huge field (100px)", () => {
  const rect = {
    top: 0,
    left: 0,
    right: 300,
    bottom: 100,
    width: 300,
    height: 100,
  };
  const box = context.computeIconBox(rect);
  assert.equal(box.size, 40);
  assert.equal(box.margin, 8);
  assert.equal(box.top, 30);
  assert.equal(box.left, 252);
});

// Tests for isEligibleLoginField detection
test("isEligibleLoginField accepts password inputs", () => {
  const passwordInput = {
    tagName: "INPUT",
    type: "password",
    disabled: false,
    readOnly: false,
    getClientRects: () => [{}],
  };
  assert.equal(context.isEligibleLoginField(passwordInput), true);
});

test("isEligibleLoginField accepts email inputs", () => {
  const emailInput = {
    tagName: "INPUT",
    type: "email",
    disabled: false,
    readOnly: false,
    getClientRects: () => [{}],
  };
  assert.equal(context.isEligibleLoginField(emailInput), true);
});

test("isEligibleLoginField accepts text inputs with login hints", () => {
  const usernameInput = {
    tagName: "INPUT",
    type: "text",
    name: "username",
    disabled: false,
    readOnly: false,
    getClientRects: () => [{}],
  };
  assert.equal(context.isEligibleLoginField(usernameInput), true);
});

test("isEligibleLoginField rejects text inputs without login hints", () => {
  const otherInput = {
    tagName: "INPUT",
    type: "text",
    name: "other",
    disabled: false,
    readOnly: false,
    getClientRects: () => [{}],
  };
  assert.equal(context.isEligibleLoginField(otherInput), false);
});

test("isEligibleLoginField rejects hidden inputs", () => {
  const hiddenInput = {
    tagName: "INPUT",
    type: "password",
    disabled: false,
    readOnly: false,
    getClientRects: () => [],
  };
  assert.equal(context.isEligibleLoginField(hiddenInput), false);
});

test("isEligibleLoginField rejects disabled inputs", () => {
  const disabledInput = {
    tagName: "INPUT",
    type: "password",
    disabled: true,
    readOnly: false,
    getClientRects: () => [{}],
  };
  assert.equal(context.isEligibleLoginField(disabledInput), false);
});

test("isEligibleLoginField rejects readonly inputs", () => {
  const readonlyInput = {
    tagName: "INPUT",
    type: "password",
    disabled: false,
    readOnly: true,
    getClientRects: () => [{}],
  };
  assert.equal(context.isEligibleLoginField(readonlyInput), false);
});

test("isEligibleLoginField rejects search inputs and undersized fields", () => {
  const searchInput = {
    tagName: "INPUT",
    type: "search",
    disabled: false,
    readOnly: false,
    getBoundingClientRect: () => ({
      top: 0,
      left: 0,
      right: 300,
      bottom: 40,
      width: 300,
      height: 40,
    }),
    getClientRects: () => [{}],
  };
  const tinyInput = {
    tagName: "INPUT",
    type: "password",
    disabled: false,
    readOnly: false,
    getBoundingClientRect: () => ({
      top: 0,
      left: 0,
      right: 70,
      bottom: 20,
      width: 70,
      height: 20,
    }),
    getClientRects: () => [{}],
  };
  assert.equal(context.isEligibleLoginField(searchInput), false);
  assert.equal(context.isEligibleLoginField(tinyInput), false);
});
