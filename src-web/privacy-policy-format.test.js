import assert from "node:assert/strict";
import test from "node:test";

import { renderPrivacyPolicy } from "./privacy-policy-format.js";

test("renders headings, lists, inline styles and code blocks", () => {
  const html = renderPrivacyPolicy(`# Title

- **One** item
- \`two\`

\`\`\`
<b>raw</b>
\`\`\`
`);

  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(
    html,
    /<ul><li><strong>One<\/strong> item<\/li><li><code>two<\/code><\/li><\/ul>/,
  );
  assert.match(html, /<pre><code>&lt;b&gt;raw&lt;\/b&gt;<\/code><\/pre>/);
});

test("escapes HTML from the source", () => {
  const html = renderPrivacyPolicy("<script>alert(1)</script>");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("renders the summary table as preformatted text", () => {
  const html = renderPrivacyPolicy("| A | B |\n|---|---|\n| 1 | 2 |");
  assert.match(html, /<pre class="policy-table"><code>/);
  assert.match(html, /\| A \| B \|/);
});
