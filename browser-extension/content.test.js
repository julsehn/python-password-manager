import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./content.js", import.meta.url), "utf8");

// Capture setInterval call for cleanup
let iconIntervalId;
const mockSetInterval = (cb, delay) => {
  iconIntervalId = setInterval(cb, delay);
  return iconIntervalId;
};

const context = vm.createContext({
  chrome: { runtime: { onMessage: { addListener() {} } } },
  document: { addEventListener() {} },
  HTMLInputElement: function HTMLInputElement() {},
  Event: class Event {},
  setTimeout,
  setInterval: mockSetInterval,
  window: { location: { hostname: "example.test" } },
});
vm.runInContext(`${source}\n;globalThis.detect = findFormFields;`, context);

test.after(() => {
  if (iconIntervalId) clearInterval(iconIntervalId);
});

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

// Tests for inline field icon injection logic
test("isEligibleField returns true for password and username inputs", () => {
  const passwordInput = {
    type: "password",
    disabled: false,
    readOnly: false,
    getClientRects: () => [{}],
  };
  const usernameInput = {
    type: "email",
    name: "email",
    disabled: false,
    readOnly: false,
    getClientRects: () => [{}],
  };
  assert.equal(context.isEligibleField(passwordInput), true);
  assert.equal(context.isEligibleField(usernameInput), true);
});

test("isEligibleField returns false for disabled or readonly inputs", () => {
  const disabledInput = {
    type: "password",
    disabled: true,
    readOnly: false,
    getClientRects: () => [{}],
  };
  const readOnlyInput = {
    type: "password",
    disabled: false,
    readOnly: true,
    getClientRects: () => [{}],
  };
  assert.equal(context.isEligibleField(disabledInput), false);
  assert.equal(context.isEligibleField(readOnlyInput), false);
});

test("isEligibleField returns false for hidden inputs", () => {
  const hiddenInput = {
    type: "password",
    disabled: false,
    readOnly: false,
    getClientRects: () => [],
  };
  assert.equal(context.isEligibleField(hiddenInput), false);
});

test("hasIcon checks for existing SherLock icons", () => {
  const inputWithIcon = { dataset: { sherlockIcon: "password" } };
  const inputWithoutIcon = { dataset: {} };
  assert.equal(context.hasIcon(inputWithIcon), true);
  assert.equal(context.hasIcon(inputWithoutIcon), false);
});
