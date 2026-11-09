import { parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { preserveGrammarFormatting } from "./grammar-format.ts";

export type HtmlText = { id: number; text: string; locked: boolean; start: number; end: number };
const protectedTags = new Set(["code", "pre", "script", "style", "textarea", "noscript", "svg", "math", "template"]);

export function htmlText(html: string): HtmlText[] {
  const parts: HtmlText[] = [];
  function visit(node: DefaultTreeAdapterTypes.Node, locked = false): void {
    if ("tagName" in node) {
      if (["head", "script", "style", "template", "noscript"].includes(node.tagName)) return;
      locked ||= protectedTags.has(node.tagName) || node.attrs.some((attr) =>
        (attr.name === "translate" && attr.value === "no") || (attr.name === "contenteditable" && attr.value === "false"));
    }
    if (node.nodeName === "#text" && "value" in node && node.value.trim()) {
      const location = node.sourceCodeLocation;
      if (!location) throw new Error("Não foi possível localizar o texto dentro do HTML.");
      parts.push({ id: parts.length, text: node.value, locked, start: location.startOffset, end: location.endOffset });
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child, locked);
  }
  visit(parse(html, { sourceCodeLocationInfo: true }));
  return parts.sort((left, right) => left.start - right.start).map((part, id) => ({ ...part, id }));
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\u00a0", "&nbsp;");
}

function pattern(value: string): RegExp {
  const escaped = value.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("\\s+"), "u");
}

/** Changes only original text-node ranges; all tags, attributes, comments and protected code stay literal. */
export function applyHtmlRevisions(html: string, plain: string, parts: HtmlText[], result: unknown): { text: string; html: string } {
  if (!Array.isArray(result) || result.length !== parts.length) throw new Error("A API retornou trechos de HTML incompletos.");
  let revisedHtml = "";
  let htmlCursor = 0;
  let revisedPlain = "";
  let plainCursor = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const candidate: unknown = result[index];
    if (typeof candidate !== "object" || candidate === null || !("id" in candidate) || candidate.id !== part.id || !("text" in candidate) || typeof candidate.text !== "string") {
      throw new Error("A API retornou um trecho de HTML inválido.");
    }
    if (part.locked && candidate.text !== part.text) throw new Error("A revisão alterou um trecho de código protegido.");
    const revision = part.locked ? part.text : preserveGrammarFormatting(part.text, candidate.text);
    const match = pattern(part.text).exec(plain.slice(plainCursor));
    if (!match) throw new Error("O HTML e o texto simples do clipboard não correspondem. Copie o texto novamente.");
    const start = plainCursor + match.index;
    revisedPlain += plain.slice(plainCursor, start) + (revision === part.text ? match[0] : revision.trim());
    plainCursor = start + match[0].length;
    revisedHtml += html.slice(htmlCursor, part.start) + (revision === part.text ? html.slice(part.start, part.end) : escapeText(revision));
    htmlCursor = part.end;
  }
  return { text: revisedPlain + plain.slice(plainCursor), html: revisedHtml + html.slice(htmlCursor) };
}
