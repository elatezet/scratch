import { Node, type JSONContent, type MarkdownToken } from "@tiptap/core";

type Property = { key: string; values: string[] };

const unquote = (v: string) =>
  v.trim().replace(/^(["'])(.*)\1$/, "$2");

function splitInlineList(v: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = "";
  for (const ch of v) {
    if (quote) {
      if (ch === quote) quote = "";
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map(unquote).filter(Boolean);
}

// Light read-only view of top-level YAML keys. The raw text stays the source
// of truth, so anything not understood here is simply left to the raw editor.
export function parseProperties(text: string): Property[] | null {
  const props: Property[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = line.match(/^([^\s:#-][^:]*?):(?:\s+(.*)|\s*)$/);
    if (kv) {
      const raw = (kv[2] ?? "").trim();
      const values =
        raw.startsWith("[") && raw.endsWith("]")
          ? splitInlineList(raw.slice(1, -1))
          : raw
            ? [unquote(raw)]
            : [];
      props.push({ key: kv[1], values });
      continue;
    }
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && props.length) {
      props[props.length - 1].values.push(unquote(item[1]));
      continue;
    }
    const cont = line.match(/^\s+(.*)$/);
    if (cont && props.length) {
      const v = props[props.length - 1].values;
      if (v.length) v[v.length - 1] += " " + cont[1].trim();
      else v.push(cont[1].trim());
      continue;
    }
    return null;
  }
  return props.length ? props : null;
}

function renderTable(table: HTMLElement, text: string): boolean {
  const props = parseProperties(text);
  table.replaceChildren();
  if (!props) return false;
  for (const { key, values } of props) {
    const row = document.createElement("div");
    row.className = "frontmatter-row";
    const k = document.createElement("span");
    k.className = "frontmatter-key";
    k.textContent = key;
    const v = document.createElement("span");
    v.className = "frontmatter-value";
    for (const val of values) {
      const chip = document.createElement("span");
      chip.className =
        values.length > 1 ? "frontmatter-chip" : "frontmatter-text";
      chip.textContent = val;
      v.appendChild(chip);
    }
    row.append(k, v);
    table.appendChild(row);
  }
  return true;
}

export const Frontmatter = Node.create({
  name: "frontmatter",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: "pre[data-frontmatter]", preserveWhitespace: "full" as const }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "pre",
      { ...HTMLAttributes, "data-frontmatter": "", class: "frontmatter" },
      ["code", 0],
    ];
  },

  addNodeView() {
    return ({ node: initial, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "frontmatter-view";
      dom.setAttribute("data-frontmatter", "");
      const table = document.createElement("div");
      table.className = "frontmatter-props";
      table.contentEditable = "false";
      const pre = document.createElement("pre");
      pre.className = "frontmatter";
      const code = document.createElement("code");
      pre.appendChild(code);
      dom.append(table, pre);

      let editing = false;
      let parsed = false;
      const sync = (text: string) => {
        parsed = renderTable(table, text);
        const raw = editing || !parsed;
        table.style.display = raw ? "none" : "";
        pre.style.display = raw ? "" : "none";
      };
      const isInside = () => {
        const pos = getPos();
        if (typeof pos !== "number") return false;
        const { from, to } = editor.state.selection;
        return from >= pos && to <= pos + currentSize;
      };
      const onSelection = () => {
        if (editing && !isInside()) {
          editing = false;
          sync(currentText);
        }
      };
      let currentText = initial.textContent;
      let currentSize = initial.nodeSize;
      sync(currentText);
      table.addEventListener("mousedown", (e) => {
        e.preventDefault();
        editing = true;
        sync(currentText);
        const pos = getPos();
        if (typeof pos === "number") {
          editor.chain().focus().setTextSelection(pos + 1).run();
        }
      });
      editor.on("selectionUpdate", onSelection);

      return {
        dom,
        contentDOM: code,
        update(updated) {
          if (updated.type.name !== "frontmatter") return false;
          currentText = updated.textContent;
          currentSize = updated.nodeSize;
          if (!editing) sync(currentText);
          else renderTable(table, currentText);
          return true;
        },
        stopEvent: (e) => !editing && table.contains(e.target as HTMLElement),
        ignoreMutation: (m) => table.contains(m.target as HTMLElement),
        destroy() {
          editor.off("selectionUpdate", onSelection);
        },
      };
    };
  },

  markdownTokenName: "frontmatter",

  markdownTokenizer: {
    name: "frontmatter",
    level: "block" as const,
    start: "---",
    tokenize(src: string, tokens: MarkdownToken[]) {
      if (tokens.length > 0) return undefined;
      const match = src.match(
        /^(?:\ufeff)?---[ \t]*\r?\n([\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/,
      );
      if (!match) return undefined;
      return {
        type: "frontmatter",
        raw: match[0],
        text: (match[1] ?? "").replace(/\r?\n$/, ""),
      };
    },
  },

  parseMarkdown(token: MarkdownToken, helpers) {
    return helpers.createNode(
      "frontmatter",
      {},
      token.text ? [helpers.createTextNode(token.text)] : [],
    );
  },

  renderMarkdown(node: JSONContent, helpers) {
    const content = node.content
      ? helpers.renderChildren(node.content).replace(/\n$/, "")
      : "";
    return `---\n${content}\n---`;
  },
});
