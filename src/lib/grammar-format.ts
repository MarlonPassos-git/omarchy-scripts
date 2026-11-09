function formattingError(): never {
  throw new Error("A revisão alterou a formatação. O texto original foi preservado; tente novamente.");
}

function linePrefix(line: string): string {
  return line.match(/^[\t ]*(?:>[\t ]?)*(?:(?:[-+*•‣▪◦]|\d+[.)]|#{1,6})[\t ]+(?:\[[ xX]\][\t ]+)?)?/)?.[0] ?? "";
}

function protectedParts(line: string): string[] {
  const code = [...line.matchAll(/(`+)[^`]*?\1/g)].map((match) => match[0]);
  const urls = [...line.matchAll(/https?:\/\/[^\s<>"']+/g)].map((match) => match[0]);
  const destinations = [...line.matchAll(/!?\[[^\]]*\]\(([^)]*)\)/g)].map((match) => match[1]);
  const markers = line.match(/\*\*|__|~~|(?<!\*)\*(?!\*)|(?<!_)_(?!_)|(?<!\\)\|/g) ?? [];
  const emoji = [...new Intl.Segmenter("pt-BR", { granularity: "grapheme" }).segment(line)]
    .map((part) => part.segment)
    .filter((part) => /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(part));
  return [...code, ...urls, ...destinations, ...markers, ...emoji];
}

/** Keeps original line endings and boundary whitespace; rejects changed Markdown structure or code. */
export function preserveGrammarFormatting(original: string, revision: string): string {
  const leading = original.match(/^\s*/)?.[0] ?? "";
  const trailing = original.match(/\s*$/)?.[0] ?? "";
  const candidate = leading + revision.trim() + trailing;
  const sourceLines = original.split(/\r\n|\n|\r/);
  const meaningful = candidate.split(/\r\n|\n|\r/).filter((line) => line.trim());
  if (meaningful.length !== sourceLines.filter((line) => line.trim()).length) formattingError();
  let nextLine = 0;
  const revisedLines = sourceLines.map((line) => line.trim() ? meaningful[nextLine++] : line);

  let fence: { marker: string; length: number } | undefined;
  for (let index = 0; index < sourceLines.length; index++) {
    const source = sourceLines[index];
    const revised = revisedLines[index];
    const delimiter = source.match(/^[\t ]*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (source !== revised) formattingError();
      if (delimiter && delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = undefined;
      continue;
    }
    if (delimiter) {
      if (source !== revised) formattingError();
      fence = { marker: delimiter[1][0], length: delimiter[1].length };
      continue;
    }
    if (!source.trim()) {
      if (revised.trim()) formattingError();
      revisedLines[index] = source;
      continue;
    }
    if (!revised.trim() || linePrefix(source) !== linePrefix(revised)) formattingError();
    if (JSON.stringify(protectedParts(source)) !== JSON.stringify(protectedParts(revised))) formattingError();
    // Two trailing spaces can be a Markdown hard break.
    revisedLines[index] = revised.trimEnd() + (source.match(/[^\S\r\n]*$/u)?.[0] ?? "");
  }
  const endings = original.match(/\r\n|\n|\r/g) ?? [];
  return revisedLines.map((line, index) => line + (endings[index] ?? "")).join("");
}
