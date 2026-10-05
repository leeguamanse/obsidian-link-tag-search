"use strict";

// The group is deliberately ordinary Markdown. Obsidian can still see its #tags.
// Link tags belong only to the link immediately before a same-line {#tag} group.
const TAG_CHAR = /[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D_/-]/u;
const TAG = /^[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D_/-]+$/u;
const NUMERIC = /^\p{N}+$/u;

function fold(value) {
  return String(value ?? "").normalize("NFC").toLowerCase();
}

function normalizeTag(value) {
  return value.trim().replace(/^#/, "").normalize("NFC");
}

function validTag(value) {
  return value.length > 0 && TAG.test(value) && !NUMERIC.test(value);
}

/** Accept an array or comma/whitespace-separated input. Invalid tags throw. */
function splitTags(input) {
  if (input == null || input === "") return [];
  const values = Array.isArray(input) ? input : [input];
  const result = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string") throw new TypeError("태그는 문자열이어야 합니다.");
    for (const token of value.split(/[\s,，]+/u).filter(Boolean)) {
      const tag = normalizeTag(token);
      if (!validTag(tag)) throw new Error(`올바르지 않은 태그입니다: ${token}`);
      const key = fold(tag);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(tag);
      }
    }
  }
  return result;
}

function formatTagGroup(tags) {
  const normalized = splitTags(tags);
  return normalized.length ? `{${normalized.map((tag) => `#${tag}`).join(" ")}}` : "";
}

function escaped(text, index) {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) count++;
  return count % 2 === 1;
}

function lineRanges(text) {
  const ranges = [];
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline + 1;
    ranges.push({ start, end, content: text.slice(start, end).replace(/\r?\n$/, "") });
    start = end;
  }
  return ranges;
}

function mark(mask, start, end) {
  mask.fill(1, start, end);
}

function anyMasked(mask, start, end) {
  for (let i = start; i < end; i++) if (mask[i]) return true;
  return false;
}

function ignoredRanges(text) {
  const mask = new Uint8Array(text.length);
  const lines = lineRanges(text);
  let frontmatter = lines.length > 0 && /^\uFEFF?---[ \t]*$/.test(lines[0].content);
  let fence = null;
  let indented = false;
  let previousBlank = true;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (frontmatter) {
      mark(mask, line.start, line.end);
      if (index > 0 && /^(---|\.\.\.)[ \t]*$/.test(line.content)) frontmatter = false;
      previousBlank = true;
      continue;
    }
    // Recognize ordinary fences and fences within blockquotes.
    const content = line.content.replace(/^(?: {0,3}>[ \t]?)+/, "");
    if (fence) {
      mark(mask, line.start, line.end);
      const closing = content.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
      previousBlank = false;
      continue;
    }
    const opening = content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      fence = { character: opening[1][0], length: opening[1].length };
      mark(mask, line.start, line.end);
      indented = false;
      previousBlank = false;
      continue;
    }
    const blank = /^[ \t]*$/.test(content);
    const indentation = /^(?: {4}|\t)/.test(content);
    if (indentation && (indented || previousBlank)) {
      mark(mask, line.start, line.end);
      indented = true;
    } else if (!blank) {
      indented = false;
    }
    previousBlank = blank;
  }
  for (let i = 0; i < text.length;) {
    if (mask[i]) { i++; continue; }
    if (!escaped(text, i) && (text.startsWith("<!--", i) || text.startsWith("%%", i))) {
      const html = text.startsWith("<!--", i);
      const delimiter = html ? "-->" : "%%";
      const closing = text.indexOf(delimiter, i + (html ? 4 : 2));
      const end = closing < 0 ? text.length : closing + delimiter.length;
      mark(mask, i, end);
      i = end;
      continue;
    }
    if (text[i] === "`" && !escaped(text, i)) {
      let end = i;
      while (text[end] === "`") end++;
      const length = end - i;
      let cursor = end;
      let closing = -1;
      while (cursor < text.length) {
        if (mask[cursor]) break;
        if (text[cursor] !== "`") { cursor++; continue; }
        let runEnd = cursor;
        while (text[runEnd] === "`") runEnd++;
        if (runEnd - cursor === length) { closing = runEnd; break; }
        cursor = runEnd;
      }
      if (closing >= 0) { mark(mask, i, closing); i = closing; continue; }
      i = end;
      continue;
    }
    i++;
  }
  return mask;
}

function unescapeMarkdown(value) {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
}

function classifyTarget(target) {
  if (/^https?:\/\/\S+/iu.test(target)) return "external";
  if (!target || /^[a-z][a-z\d+.-]*:/iu.test(target) || target.startsWith("//")) return null;
  return "internal";
}

function parseWiki(text, start) {
  if (!text.startsWith("[[", start)) return null;
  let end = start + 2;
  let pipe = -1;
  for (; end < text.length; end++) {
    if (text[end] === "\n" || text[end] === "\r") return null;
    if (escaped(text, end)) continue;
    if (text[end] === "|" && pipe < 0) pipe = end;
    if (text.startsWith("]]", end)) break;
  }
  if (end >= text.length) return null;
  const target = unescapeMarkdown(text.slice(start + 2, pipe < 0 ? end : pipe).trim());
  if (!target) return null;
  const label = pipe < 0 ? target : unescapeMarkdown(text.slice(pipe + 1, end).trim());
  return { kind: "internal", target, label, start, end: end + 2 };
}

function parseMarkdownLink(text, start) {
  if (text[start] !== "[" || text[start + 1] === "[") return null;
  let cursor = start + 1;
  let depth = 1;
  for (; cursor < text.length; cursor++) {
    if (text[cursor] === "\n" || text[cursor] === "\r") return null;
    if (escaped(text, cursor)) continue;
    if (text[cursor] === "[") depth++;
    if (text[cursor] === "]" && --depth === 0) break;
  }
  if (text[cursor] !== "]" || text[cursor + 1] !== "(") return null;
  const label = unescapeMarkdown(text.slice(start + 1, cursor));
  cursor += 2;
  while (text[cursor] === " " || text[cursor] === "\t") cursor++;
  let destination;
  if (text[cursor] === "<") {
    const begin = ++cursor;
    while (cursor < text.length && !(text[cursor] === ">" && !escaped(text, cursor))) {
      if (text[cursor] === "\n" || text[cursor] === "\r") return null;
      cursor++;
    }
    if (text[cursor] !== ">") return null;
    destination = text.slice(begin, cursor++);
  } else {
    const begin = cursor;
    let parentheses = 0;
    for (; cursor < text.length; cursor++) {
      const character = text[cursor];
      if (character === "\n" || character === "\r") return null;
      if (escaped(text, cursor)) continue;
      if (character === "(") parentheses++;
      else if (character === ")") {
        if (parentheses === 0) break;
        parentheses--;
      } else if (/\s/u.test(character) && parentheses === 0) break;
    }
    destination = text.slice(begin, cursor);
  }
  let hadSpace = false;
  while (text[cursor] === " " || text[cursor] === "\t") { cursor++; hadSpace = true; }
  if (hadSpace && ['"', "'", "("].includes(text[cursor])) {
    const closing = text[cursor] === "(" ? ")" : text[cursor];
    cursor++;
    while (cursor < text.length && !(text[cursor] === closing && !escaped(text, cursor))) {
      if (text[cursor] === "\n" || text[cursor] === "\r") return null;
      cursor++;
    }
    if (text[cursor] !== closing) return null;
    cursor++;
    while (text[cursor] === " " || text[cursor] === "\t") cursor++;
  }
  if (text[cursor] !== ")") return null;
  const target = unescapeMarkdown(destination.trim());
  return { kind: classifyTarget(target), target, label, start, end: cursor + 1 };
}

function parseAutolink(text, start) {
  if (text[start] !== "<") return null;
  const match = text.slice(start).match(/^<(https?:\/\/[^<>\s]+)>/iu);
  if (!match) return null;
  return { kind: "external", target: match[1], label: match[1], start, end: start + match[0].length };
}

function parseBareUrl(text, start, mask) {
  if ((text[start] !== "h" && text[start] !== "H") || !/^https?:\/\//iu.test(text.slice(start, start + 8))) return null;
  // A protocol embedded in a word is not a separate link. Explicit Markdown
  // and autolinks are consumed before this parser, preventing duplicate rows.
  if (start > 0 && /[\p{L}\p{M}\p{N}_@]/u.test(text[start - 1])) return null;
  let end = start;
  let parentheses = 0;
  let brackets = 0;
  for (; end < text.length && !mask[end]; end++) {
    const character = text[end];
    if (/[\s<>"'`{}“”‘’「」『』【】〈〉《》（）]/u.test(character)) break;
    if (character === "(") parentheses++;
    else if (character === ")") {
      if (parentheses === 0) break;
      parentheses--;
    } else if (character === "[") brackets++;
    else if (character === "]") {
      if (brackets === 0) break;
      brackets--;
    }
  }
  // Typical pasted prose places punctuation directly after a URL. Encoded
  // punctuation remains intact, as do balanced parentheses and IPv6 brackets.
  while (end > start && /[.,;:!?。，、；：！？…]/u.test(text[end - 1])) end--;
  const target = text.slice(start, end);
  try {
    const url = new URL(target);
    if (!url.hostname || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  } catch {
    return null;
  }
  return { kind: "external", target, label: target, start, end };
}

function readTagGroup(text, end, mask) {
  let start = end;
  while (text[start] === " " || text[start] === "\t") start++;
  if (text[start] !== "{") return null;
  const closing = text.indexOf("}", start + 1);
  if (closing < 0 || /[\r\n]/.test(text.slice(start, closing)) || anyMasked(mask, start, closing + 1)) return null;
  const content = text.slice(start + 1, closing).trim();
  const tokens = content.split(/[ \t]+/);
  if (!content || tokens.some((token) => !token.startsWith("#") || !validTag(normalizeTag(token)))) return null;
  return { tagStart: start, tagEnd: closing + 1, tags: splitTags(tokens) };
}

/** Parse common inline links. All offsets are UTF-16; line numbers are zero-based. */
function parseDocument(text) {
  const mask = ignoredRanges(text);
  const tagMask = mask.slice();
  const links = [];
  let line = 0;
  let lastPosition = 0;
  for (let i = 0; i < text.length;) {
    if (mask[i] || escaped(text, i)) { i++; continue; }
    const parsed = parseWiki(text, i) || parseMarkdownLink(text, i) || parseAutolink(text, i) || parseBareUrl(text, i, mask);
    if (!parsed) { i++; continue; }
    // Even unsupported URL schemes and images are consumed, so their labels and
    // URL fragments cannot accidentally turn into links or tags of their own.
    mark(tagMask, i, parsed.end);
    const isImage = i > 0 && text[i - 1] === "!" && !escaped(text, i - 1);
    if (parsed.kind && !isImage && !anyMasked(mask, i, parsed.end)) {
      for (let j = lastPosition; j < i; j++) if (text[j] === "\n") line++;
      lastPosition = i;
      const group = readTagGroup(text, parsed.end, mask);
      links.push({ ...parsed, tagStart: null, tagEnd: null, tags: [], line, ...group });
    }
    i = parsed.end;
  }
  const inlineTags = [];
  const seen = new Set();
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "#" || tagMask[i] || escaped(text, i)) continue;
    const surrogatePair = i >= 2 && /[\uDC00-\uDFFF]/.test(text[i - 1]) && /[\uD800-\uDBFF]/.test(text[i - 2]);
    const previous = i > 0 ? text.slice(i - (surrogatePair ? 2 : 1), i) : "";
    if (previous === "#" || TAG_CHAR.test(previous)) continue;
    let end = i + 1;
    while (end < text.length && !tagMask[end]) {
      const character = String.fromCodePoint(text.codePointAt(end));
      if (!TAG_CHAR.test(character)) break;
      end += character.length;
    }
    const tag = text.slice(i + 1, end).normalize("NFC");
    if (validTag(tag) && !seen.has(fold(tag))) { inlineTags.push(tag); seen.add(fold(tag)); }
    i = end - 1;
  }
  return { links, inlineTags };
}

/** Refuse writes if the captured occurrence no longer matches the document. */
function replaceLinkTags(text, occurrence, tags) {
  const group = formatTagGroup(tags);
  const current = parseDocument(text).links.find((link) => link.start === occurrence.start);
  const fields = ["end", "kind", "target", "label", "tagStart", "tagEnd"];
  if (!current || fields.some((field) => current[field] !== occurrence[field]) ||
      JSON.stringify(current.tags) !== JSON.stringify(occurrence.tags)) {
    throw new Error("링크가 변경되었습니다. 링크를 다시 선택해 주세요.");
  }
  const end = current.tagEnd ?? current.end;
  return text.slice(0, current.end) + (group ? ` ${group}` : "") + text.slice(end);
}

function queryTerms(query) {
  const terms = [];
  let token = "";
  let quoted = false;
  for (let i = 0; i < query.length; i++) {
    const character = query[i];
    if (character === "\\" && query[i + 1] === '"') { token += '"'; i++; }
    else if (character === '"') quoted = !quoted;
    else if (/\s/u.test(character) && !quoted) {
      if (token) terms.push(fold(token));
      token = "";
    } else token += character;
  }
  if (token) terms.push(fold(token));
  return terms;
}

/** AND search. #tag/tag:tag match exact tags and their slash-delimited children. */
function searchEntries(entries, query) {
  const terms = queryTerms(String(query ?? ""));
  const results = [];
  for (const entry of entries) {
    const title = fold(entry.title);
    const path = fold(entry.path);
    const body = fold(entry.body);
    const target = fold(entry.target);
    const tags = (entry.tags || []).filter((tag) => typeof tag === "string").map((tag) => fold(normalizeTag(tag)));
    let score = 0;
    let matches = true;
    for (const term of terms) {
      const tagOnly = term.startsWith("#") || term.startsWith("tag:");
      const needle = tagOnly ? term.replace(/^(?:tag:)?#?/, "") : term;
      let termScore = 0;
      if (needle) {
        if (tags.some((tag) => tag === needle)) termScore = 100;
        else if (tags.some((tag) => tag.startsWith(`${needle}/`))) termScore = 85;
        else if (!tagOnly && tags.some((tag) => tag.includes(needle))) termScore = 55;
        if (!tagOnly) {
          if (title === needle) termScore = Math.max(termScore, 95);
          else if (title.startsWith(needle)) termScore = Math.max(termScore, 80);
          else if (title.includes(needle)) termScore = Math.max(termScore, 65);
          if (target.includes(needle)) termScore = Math.max(termScore, 40);
          if (path.includes(needle)) termScore = Math.max(termScore, 30);
          if (body.includes(needle)) termScore = Math.max(termScore, 20);
        }
      }
      if (termScore === 0) { matches = false; break; }
      score += termScore;
    }
    if (matches) results.push({ entry, score });
  }
  return results.sort((a, b) => b.score - a.score);
}

module.exports = { parseDocument, splitTags, formatTagGroup, replaceLinkTags, searchEntries };
