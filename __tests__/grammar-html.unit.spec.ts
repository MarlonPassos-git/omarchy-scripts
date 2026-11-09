import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlText, applyHtmlRevisions } from "../src/lib/grammar-html.ts";
import { preserveGrammarFormatting } from "../src/lib/grammar-format.ts";

const html = '<html>\n<body>\n<!--StartFragment--><span data-teams="true"><p>pelo o que eu pesquisei aqui isso só iria nos impactar se a opção:&nbsp;</p><p>&nbsp;</p><p><code class="skipProofing" spellcheck="false"><strong>remote_cluster_server.enabled: true</strong></code></p><p>&nbsp;</p><p>tivesse ativada.</p><p>&nbsp;</p><p>se não tiver, n tem pq se preocupar tanto</p></span><!--EndFragment-->\n</body>\n</html>';
const plain = 'pelo o que eu pesquisei aqui isso só iria nos impactar se a opção: \n\n\n\nremote_cluster_server.enabled: true\n\n\n\ntivesse ativada.\n\n\n\nse não tiver, n tem pq se preocupar tanto';

test("Teams paragraphs, blank lines and code markup survive revision byte for byte", () => {
  const parts = htmlText(html);
  const answers = parts.map(({ id, text }) => ({ id, text }));
  answers[0].text = 'Pelo que pesquisei aqui, isso só iria nos impactar se a opção:';
  answers[2].text = 'estivesse ativada.';
  answers[3].text = 'Se não estiver, não tem por que se preocupar tanto.';
  const result = applyHtmlRevisions(html, plain, parts, answers);
  assert.equal(result.html, html
    .replace('pelo o que eu pesquisei aqui isso só iria nos impactar se a opção:', answers[0].text)
    .replace('tivesse ativada.', answers[2].text)
    .replace('se não tiver, n tem pq se preocupar tanto', answers[3].text));
  assert.equal(result.text, plain
    .replace('pelo o que eu pesquisei aqui isso só iria nos impactar se a opção:', answers[0].text)
    .replace('tivesse ativada.', answers[2].text)
    .replace('se não tiver, n tem pq se preocupar tanto', answers[3].text));
});

test("edited text is escaped, while attributes, links, entities and protected code remain untouched", () => {
  const source = '<p style="color:red">texto <a href="https://example.com?q=a&amp;b=c">link</a> <code>x &lt; y</code></p>';
  const parts = htmlText(source);
  const answers = parts.map(({ id, text }) => ({ id, text: id === 0 ? 'texto <img src=x onerror=alert(1)> ' : text }));
  const result = applyHtmlRevisions(source, 'texto link x < y', parts, answers);
  assert.ok(result.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(result.html.includes('<a href="https://example.com?q=a&amp;b=c">link</a>'));
  assert.ok(result.html.includes('<code>x &lt; y</code>'));
  assert.ok(!result.html.includes('<img'));
});

test("invalid segment ids, changed code and mismatched clipboard representations are rejected", () => {
  const parts = htmlText(html);
  const answers = parts.map(({ id, text }) => ({ id, text }));
  assert.throws(() => applyHtmlRevisions(html, plain, parts, answers.slice(1)), /incompletos/);
  assert.throws(() => applyHtmlRevisions(html, plain, parts, answers.map((part) => ({ ...part, id: 99 }))), /inválido/);
  assert.throws(() => applyHtmlRevisions(html, plain, parts, answers.map((part) => part.id === 1 ? { ...part, text: 'remote_cluster_server.enabled: false' } : part)), /código protegido/);
  assert.throws(() => applyHtmlRevisions(html, 'outra seleção', parts, answers), /não correspondem/);
});

test("plain-text revisions recover Teams blank-line spacing without joining substantive lines", () => {
  const revised = plain.replaceAll('\n\n\n\n', '\n\n').replace('pelo o que', 'Pelo que');
  assert.equal(preserveGrammarFormatting(plain, revised), plain.replace('pelo o que', 'Pelo que'));
  assert.throws(() => preserveGrammarFormatting('Primeira\nSegunda', 'Primeira e segunda'), /formatação/);
});
