import { cp, readFile, writeFile } from "node:fs/promises";
import { Marked, Renderer } from "marked";

export async function buildGuide() {
  const pages = [
    { input: "guide.md", output: "guide.html", label: "How to read a mint" },
    {
      input: "architecture.md",
      output: "architecture.html",
      label: "Architecture",
    },
    { input: "api.md", output: "api.html", label: "API" },
  ];
  const links = Object.fromEntries(
    pages.map((page) => [page.input, `/${page.output}`]),
  );
  await cp("docs/architecture.svg", "dist/public/architecture.svg");
  for (const page of pages) {
    // Only trusted repository Markdown is rendered during the build, never RPC input.
    const markdown = new Marked({
      renderer: {
        heading({ text, tokens, depth }) {
          const id = text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
        },
        link(token) {
          const [path, fragment] = token.href.split("#");
          const href = links[path]
            ? `${links[path]}${fragment ? `#${fragment}` : ""}`
            : token.href;
          return Renderer.prototype.link.call(this, { ...token, href });
        },
        table(token) {
          return `<div class="docs-table">${Renderer.prototype.table.call(this, token)}</div>`;
        },
      },
    });
    const content = markdown
      .parse(await readFile(`docs/${page.input}`, "utf8"))
      .replaceAll("<pre>", '<pre tabindex="0">');
    await writeFile(
      `dist/public/${page.output}`,
      `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="description" content="${page.label} for Solana Authority Inspector."/>
<title>${page.label} | Authority Inspector</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="stylesheet" href="/guide.css"/></head>
<body class="docs-page"><a class="skip" href="#content">Skip to content</a>
<header class="docs-header"><a class="docs-brand" href="/">Authority Inspector</a><a href="/">Back to inspector</a></header>
<div class="docs-layout"><nav aria-label="Documentation">${pages.map((item) => `<a href="/${item.output}"${item === page ? ' aria-current="page"' : ""}>${item.label}</a>`).join("")}</nav>
<main class="docs-content" id="content" tabindex="-1">${content}</main></div>
<footer>Read-only. Free and open source.</footer></body></html>`,
    );
  }
}
