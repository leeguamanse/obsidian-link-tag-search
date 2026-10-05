"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDocument, splitTags, formatTagGroup, replaceLinkTags, searchEntries } = require("../src/core.js");

test("two links on one line retain independent tag groups and UTF-16 offsets", () => {
  const text = "앞🙂 [[자료#제목|첫 링크]] {#연구 #읽기} 그리고 [둘째](https://example.com/a_(b)) {#업무}\r\n[[마지막]]";
  const { links, inlineTags } = parseDocument(text);
  assert.equal(links.length, 3);
  assert.deepEqual(links.map((link) => link.tags), [["연구", "읽기"], ["업무"], []]);
  assert.deepEqual(links.map((link) => link.kind), ["internal", "external", "internal"]);
  assert.deepEqual(links.map((link) => link.line), [0, 0, 1]);
  assert.equal(links[0].target, "자료#제목");
  assert.equal(links[0].label, "첫 링크");
  assert.equal(links[0].start, text.indexOf("[[자료"));
  assert.equal(text.slice(links[0].start, links[0].end), "[[자료#제목|첫 링크]]");
  assert.equal(text.slice(links[1].tagStart, links[1].tagEnd), "{#업무}");
  assert.deepEqual(inlineTags, ["연구", "읽기", "업무"]);
});

test("ignores frontmatter, fenced/indented/inline code, comments, embeds and images", () => {
  const text = [
    "---", "tags: [native]", 'link: "[[yaml]]"', "---",
    "```md", "[[fence]] {#fenced}", "```", "",
    "    [[indented]] #indented", "",
    "`[[inline]] #inline` and ``text ` [[double]] #double``",
    "<!-- [[comment]] #comment -->", "%% [[obsidian-comment]] #hidden %%",
    "![[embed]] ![image [inner]](https://image.test/#fragment)",
    "[email](mailto:a@example.com) [script](javascript:alert(1))",
    "[[real]] {#visible} #ordinary",
  ].join("\n");
  const parsed = parseDocument(text);
  assert.deepEqual(parsed.links.map((link) => link.target), ["real"]);
  assert.deepEqual(parsed.inlineTags, ["visible", "ordinary"]);
});

test("comments inside code cannot swallow subsequent real links", () => {
  const parsed = parseDocument("`<!--` [[real]] #yes\n``%%`` [[two]]");
  assert.deepEqual(parsed.links.map((link) => link.target), ["real", "two"]);
  assert.deepEqual(parsed.inlineTags, ["yes"]);
});

test("supports balanced URL parentheses, escaped brackets, titles and angle destinations", () => {
  const text = '[a [nested] label](https://ex.test/a(b(c)) "a title") {#x} [escaped\\] label](folder/a\\(b\\).md) [space](<folder/a b.md>) <https://ex.test/path#anchor> {#자동}';
  const links = parseDocument(text).links;
  assert.equal(links.length, 4);
  assert.deepEqual(links.map((link) => link.target), ["https://ex.test/a(b(c))", "folder/a(b).md", "folder/a b.md", "https://ex.test/path#anchor"]);
  assert.equal(links[0].label, "a [nested] label");
  assert.equal(links[1].label, "escaped] label");
  assert.deepEqual(links[3].tags, ["자동"]);
  assert.deepEqual(parseDocument(text).inlineTags, ["x", "자동"]);
});

test("group association is adjacent, bounded and confined to the same line", () => {
  const links = parseDocument("[[one]] #unbound [[two]] {#two} [[three]] text {#unbound}\n[[four]]\n{#next-line}\n[[five]] {#valid, #invalid}\n[[six]]{#six}").links;
  assert.deepEqual(links.map((link) => link.tags), [[], ["two"], [], [], [], ["six"]]);
  assert.equal(links[0].tagStart, null);
});

test("ignores escaped link openings and native tag lookalikes", () => {
  const parsed = parseDocument("\\[[escaped]] \\[escaped](x) [[good]] abc#joined #123 #a/b #OK \\#escaped ##heading #📚 #한글");
  assert.deepEqual(parsed.links.map((link) => link.target), ["good"]);
  assert.deepEqual(parsed.inlineTags, ["a/b", "OK", "📚", "한글"]);
});

test("splitTags validates, normalizes Unicode and deduplicates without losing display case", () => {
  assert.deepEqual(splitTags("#한글, 한글 #Work work 연구/자료 읽기_대기 읽기-완료 #📚"), ["한글", "Work", "연구/자료", "읽기_대기", "읽기-완료", "📚"]);
  assert.deepEqual(splitTags(["e\u0301", "é"]), ["é"]);
  assert.deepEqual(splitTags("  "), []);
  for (const invalid of ["#123", "#", "two.words", "#bad!", "https://example.com"]) {
    assert.throws(() => splitTags(invalid));
  }
  assert.throws(() => splitTags([42]), TypeError);
  assert.equal(formatTagGroup(["a", "#B", "a"]), "{#a #B}");
  assert.equal(formatTagGroup([]), "");
});

test("editing one occurrence cannot change another identical link on the same line", () => {
  const text = "[[Same]] {#첫째} 그리고 [[Same]] {#둘째} 끝";
  const occurrence = parseDocument(text).links[1];
  assert.equal(replaceLinkTags(text, occurrence, "#수정, 읽기"), "[[Same]] {#첫째} 그리고 [[Same]] {#수정 #읽기} 끝");
  assert.equal(replaceLinkTags(text, occurrence, []), "[[Same]] {#첫째} 그리고 [[Same]] 끝");
  const untagged = "[[new]] 문장";
  assert.equal(replaceLinkTags(untagged, parseDocument(untagged).links[0], ["새태그"]), "[[new]] {#새태그} 문장");
});

test("stale link or tag edits are refused rather than applied at old offsets", () => {
  const text = "[[old]] {#before}";
  const occurrence = parseDocument(text).links[0];
  assert.throws(() => replaceLinkTags(text.replace("old", "new"), occurrence, ["after"]), /다시 선택/);
  assert.throws(() => replaceLinkTags(text.replace("before", "edited"), occurrence, ["after"]), /다시 선택/);
  assert.throws(() => replaceLinkTags("prefix " + text, occurrence, ["after"]), /다시 선택/);
  assert.throws(() => replaceLinkTags(text, occurrence, ["123"]), /태그/);
});

test("ordinary terms search tags and text with AND semantics; exact tags rank first", () => {
  const entries = [
    { id: "body", kind: "note", title: "다른 노트", path: "note.md", body: "연구와 계획", tags: [] },
    { id: "tag", kind: "link", title: "계획", path: "links.md", target: "https://example.com", tags: ["연구"] },
    { id: "unrelated", kind: "note", title: "연구", path: "unrelated.md", tags: [] },
  ];
  assert.deepEqual(searchEntries(entries, "연구 계획").map((result) => result.entry.id), ["tag", "body"]);
  assert.deepEqual(searchEntries(entries, "#연구").map((result) => result.entry.id), ["tag"]);
  assert.deepEqual(searchEntries(entries, "example").map((result) => result.entry.id), ["tag"]);
  assert.equal(searchEntries(entries, "").length, 3);
  assert.equal(searchEntries(entries, "#").length, 0);
  assert.equal(searchEntries(entries, "tag:").length, 0);
});

test("tag queries support hierarchy, normalized Unicode and case; quotes preserve phrases", () => {
  const entries = [
    { id: "child", kind: "link", title: "Alpha Beta", path: "a.md", tags: ["#Work/Research", "é", "한글"] },
    { id: "suffix", kind: "note", title: "Alpha something Beta", path: "b.md", tags: ["other/Work"] },
  ];
  for (const query of ["#work", "tag:WORK", "tag:#work/research", "e\u0301", '"alpha beta"', "한글"]) {
    assert.deepEqual(searchEntries(entries, query).map((result) => result.entry.id), ["child"]);
  }
  assert.equal(searchEntries(entries, "#wor").length, 0);
  assert.equal(searchEntries(entries, "alpha beta").length, 2);
});

test("unterminated frontmatter and fences stay ignored and longer closers work", () => {
  assert.equal(parseDocument("---\n[[hidden]]").links.length, 0);
  assert.equal(parseDocument("```\n[[hidden]]").links.length, 0);
  assert.deepEqual(parseDocument("~~~js\n[[hidden]]\n~~~~\n[[shown]]").links.map((link) => link.target), ["shown"]);
  assert.deepEqual(parseDocument("> ```\n> [[hidden]]\n> ```\n[[shown]]").links.map((link) => link.target), ["shown"]);
});

test("bare pasted links trim sentence punctuation and retain Korean URLs and fragments", () => {
  const text = "자료: https://example.com/한국어#항목 {#연구}\r\n다음 https://example.org/path。 그리고 https://example.net/a,\n끝 https://example.edu/last！？";
  const parsed = parseDocument(text);
  assert.deepEqual(parsed.links.map((link) => link.target), [
    "https://example.com/한국어#항목", "https://example.org/path", "https://example.net/a", "https://example.edu/last",
  ]);
  assert.deepEqual(parsed.links.map((link) => link.line), [0, 1, 1, 2]);
  assert.deepEqual(parsed.links[0].tags, ["연구"]);
  assert.deepEqual(parsed.inlineTags, ["연구"]);
  for (const link of parsed.links) assert.equal(text.slice(link.start, link.end), link.target);
});

test("bare URL parentheses and IPv6 brackets stay balanced while surrounding closers stop the link", () => {
  const text = "(https://example.com/a(b(c))). [https://example.org/a[b]], https://[::1]:8080/a_(b) {#로컬} https://example.net/)입니다";
  assert.deepEqual(parseDocument(text).links.map((link) => link.target), [
    "https://example.com/a(b(c))", "https://example.org/a[b]", "https://[::1]:8080/a_(b)", "https://example.net/",
  ]);
});

test("bare URLs stop at tags, quotes and markup boundaries without swallowing groups", () => {
  const text = 'https://a.test/{#첫째} https://b.test/ {#둘째} "https://c.test/" <https://d.test/> “https://e.test/”';
  const parsed = parseDocument(text);
  assert.deepEqual(parsed.links.map((link) => link.target), ["https://a.test/", "https://b.test/", "https://c.test/", "https://d.test/", "https://e.test/"]);
  assert.deepEqual(parsed.links.map((link) => link.tags), [["첫째"], ["둘째"], [], [], []]);
  assert.equal(replaceLinkTags(text, parsed.links[0], ["수정"]), text.replace("https://a.test/{#첫째}", "https://a.test/ {#수정}"));
});

test("bare URL scan avoids duplicate links, hidden spans, embedded schemes and fragments as tags", () => {
  const text = [
    '[https://label.test/](https://markdown.test/#anchor) {#명시}',
    '<https://auto.test/?q=#fragment> {#자동}',
    '![](https://image.test/) `https://code.test/` <!-- https://comment.test/ -->',
    'abcHTTPS://embedded.test/ ftp://unsupported.test/',
    'https://bare.test/?q=#not-a-tag {#원문}',
  ].join("\n");
  const parsed = parseDocument(text);
  assert.deepEqual(parsed.links.map((link) => link.target), [
    "https://markdown.test/#anchor", "https://auto.test/?q=#fragment", "https://bare.test/?q=#not-a-tag",
  ]);
  assert.deepEqual(parsed.inlineTags, ["명시", "자동", "원문"]);
});
