'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../src/core');

const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

class Events {
  constructor() { this.handlers = new Map(); }
  on(name, callback) {
    if (!this.handlers.has(name)) this.handlers.set(name, []);
    this.handlers.get(name).push(callback);
    return {name, callback};
  }
  emit(name, ...args) { for (const callback of this.handlers.get(name) || []) callback(...args); }
}

async function harness() {
  const modals = [], notices = [], errors = [], files = new Map(), contents = new Map(), frontmatters = new Map(), caches = new Map();
  class TFile {
    constructor(filePath) { this.rename(filePath); }
    rename(filePath) { this.path = filePath; this.name = filePath.split('/').pop(); this.extension = this.name.split('.').pop(); this.basename = this.name.replace(/\.[^.]+$/, ''); }
  }
  class Plugin {
    constructor(app) { this.app = app; this.commands = []; }
    registerView() {}
    addRibbonIcon() {}
    addCommand(command) { this.commands.push(command); }
    registerEvent() {}
  }
  class Modal {
    constructor(app) { this.app = app; }
    open() { modals.push(this); }
    close() {}
  }
  class ItemView {}
  class MarkdownView {}
  class Setting {}
  class Notice { constructor(message) { notices.push(message); } }
  const vault = Object.assign(new Events(), {
    getMarkdownFiles: () => [...files.values()].filter(file => file.extension === 'md'),
    getAbstractFileByPath: filePath => files.get(filePath) || null,
    cachedRead: file => Promise.resolve(contents.get(file.path)),
    read: file => Promise.resolve(contents.get(file.path)),
    process: async (file, callback) => { const next = callback(contents.get(file.path)); contents.set(file.path, next); return next; }
  });
  const metadataCache = Object.assign(new Events(), {getFileCache: file => caches.get(file.path) || null});
  const workspace = Object.assign(new Events(), {
    leaves: [],
    getLeavesOfType: type => type === 'markdown' ? workspace.leaves : [],
    getActiveFile: () => workspace.leaves[0]?.view.file || null,
    getActiveViewOfType: () => workspace.leaves[0]?.view || null,
    onLayoutReady: callback => { workspace.layoutReady = callback; },
    detachLeavesOfType: () => { workspace.detached = true; }
  });
  const app = {vault, metadataCache, workspace, fileManager: {
    processFrontMatter: async (file, callback) => {
      const current = structuredClone(frontmatters.get(file.path) || {});
      callback(current);
      frontmatters.set(file.path, current);
    }
  }};
  const module = {exports:{}};
  vm.runInNewContext(source, {
    require: id => {
      assert.equal(id, 'obsidian');
      return {Plugin, Modal, ItemView, MarkdownView, Setting, Notice, TFile, getAllTags: cache => cache.allTags || []};
    },
    Core, module, window: {setTimeout, clearTimeout},
    console: {error: (...args) => errors.push(args)}
  }, {filename:'src/main.js'});
  const plugin = new module.exports(app);
  await plugin.onload();
  function add(filePath, text, frontmatter = {}, allTags = []) {
    const file = new TFile(filePath);
    files.set(filePath, file); contents.set(filePath, text);
    frontmatters.set(filePath, structuredClone(frontmatter));
    caches.set(filePath, {frontmatter:structuredClone(frontmatter), allTags});
    return file;
  }
  function rename(file, destination) {
    const oldPath = file.path;
    for (const map of [files, contents, frontmatters, caches]) {
      const value = map.get(oldPath); map.delete(oldPath); map.set(destination, value);
    }
    file.rename(destination);
    return oldPath;
  }
  return {plugin, app, vault, metadataCache, workspace, files, contents, frontmatters, caches, modals, notices, errors, add, rename};
}

function editorFor(text) {
  let value = text;
  const toOffset = position => {
    const lines = value.split('\n');
    return lines.slice(0, position.line).reduce((count, line) => count + line.length + 1, 0) + position.ch;
  };
  return {
    changes: [],
    getValue: () => value,
    setValue: next => { value = next; },
    posToOffset: toOffset,
    offsetToPos: offset => { const lines = value.slice(0, offset).split('\n'); return {line:lines.length - 1, ch:lines.at(-1).length}; },
    getCursor: () => ({line:0, ch:0}),
    replaceRange(replacement, from, to) {
      const start = toOffset(from), end = toOffset(to);
      this.changes.push({replacement, start, end});
      value = value.slice(0, start) + replacement + value.slice(end);
    }
  };
}

test('index includes native tags, body tags, and separately tagged link occurrences', async () => {
  const h = await harness();
  const file = h.add('자료.md', '본문 #읽기\n[[문서]] {#예산}\n[[문서]] {#인사}\n[사이트](https://example.com) {#참조}', {tags:['개발']}, ['#개발', '#읽기']);
  await h.plugin.refreshFile(file);
  const entries = h.plugin.entries();
  assert.equal(entries.length, 4);
  assert.deepEqual(plain(entries[0].tags), ['개발', '읽기', '예산', '인사', '참조']);
  const links = entries.filter(entry => entry.kind === 'link');
  assert.deepEqual(plain(Core.searchEntries(links, '#예산').map(match => match.entry.line)), [1]);
  assert.deepEqual(plain(Core.searchEntries(links, '#인사').map(match => match.entry.line)), [2]);
  assert.equal(Core.searchEntries(links, '#참조')[0].entry.target, 'https://example.com');
});

test('a slower earlier read cannot replace a later index update', async () => {
  const h = await harness(), oldRead = deferred(), newRead = deferred();
  const file = h.add('Note.md', 'unused');
  let reads = 0;
  h.vault.cachedRead = () => (++reads === 1 ? oldRead.promise : newRead.promise);
  const earlier = h.plugin.refreshFile(file), later = h.plugin.refreshFile(file);
  newRead.resolve('[[Fresh]] {#new}'); await later;
  oldRead.resolve('[[Stale]] {#old}'); await earlier;
  assert.equal(h.plugin.index.get(file.path).text, '[[Fresh]] {#new}');
});

test('delete during an in-flight read does not resurrect a note', async () => {
  const h = await harness(), read = deferred();
  const file = h.add('Note.md', 'old');
  h.vault.cachedRead = () => read.promise;
  const pending = h.plugin.refreshFile(file);
  h.files.delete(file.path); h.vault.emit('delete', file);
  read.resolve('[[Stale]] {#old}'); await pending;
  assert.equal(h.plugin.index.size, 0);
});

test('a deleted file replaced at the same path is not indexed from its old read', async () => {
  const h = await harness(), read = deferred();
  const original = h.add('Note.md', 'old');
  h.vault.cachedRead = () => read.promise;
  const pending = h.plugin.refreshFile(original);
  h.files.delete(original.path); h.vault.emit('delete', original);
  h.add('Note.md', 'replacement');
  read.resolve('stale'); await pending;
  assert.equal(h.plugin.index.size, 0);
});

test('rename during an in-flight read retains only the new path', async () => {
  const h = await harness(), read = deferred();
  const file = h.add('Old.md', '[[Target]] {#saved}');
  let reads = 0;
  h.vault.cachedRead = current => ++reads === 1 ? read.promise : Promise.resolve(h.contents.get(current.path));
  const pending = h.plugin.refreshFile(file);
  const oldPath = h.rename(file, 'New.md');
  h.vault.emit('rename', file, oldPath); await tick();
  read.resolve('stale'); await pending;
  assert.deepEqual([...h.plugin.index.keys()], ['New.md']);
  assert.equal(h.plugin.entries()[0].title, 'New');
});

test('folder rename during rebuild reindexes children already processed', async () => {
  const h = await harness(), secondRead = deferred();
  const first = h.add('Old/First.md', 'first'), second = h.add('Old/Second.md', 'second');
  let secondReads = 0;
  h.vault.cachedRead = file => file === second && ++secondReads === 1 ? secondRead.promise : Promise.resolve(h.contents.get(file.path));
  const pending = h.plugin.rebuild(); await tick();
  assert.equal(h.plugin.index.has('Old/First.md'), true);
  h.rename(first, 'New/First.md'); h.rename(second, 'New/Second.md');
  h.vault.emit('rename', {path:'New'}, 'Old');
  secondRead.resolve('second'); await pending; await tick();
  assert.deepEqual([...h.plugin.index.keys()].sort(), ['New/First.md', 'New/Second.md']);
});

test('unload while indexing prevents late results and listener updates', async () => {
  const h = await harness(), read = deferred();
  const file = h.add('Note.md', 'body');
  let emits = 0; h.plugin.subscribe(() => emits++);
  h.vault.cachedRead = () => read.promise;
  const pending = h.plugin.refreshFile(file);
  h.plugin.onunload(); read.resolve('late result'); await pending;
  assert.equal(h.plugin.index.size, 0); assert.equal(emits, 0); assert.equal(h.workspace.detached, undefined);
});

test('note tag edits preserve unrelated properties and inline body tags', async () => {
  const h = await harness();
  const body = '# Note\nBody #inline';
  const file = h.add('Note.md', body, {tags:['old'], aliases:['Alias'], custom:{nested:true}}, ['#old', '#inline']);
  h.plugin.editNote(file);
  await h.modals.at(-1).onSave(['new']);
  assert.deepEqual(plain(h.frontmatters.get(file.path)), {tags:['new'], aliases:['Alias'], custom:{nested:true}});
  assert.equal(h.contents.get(file.path), body);
});

test('note tag removal removes only the tags property', async () => {
  const h = await harness(), file = h.add('Note.md', '#body', {tags:['old'], title:'Keep'});
  h.plugin.editNote(file); await h.modals.at(-1).onSave([]);
  assert.deepEqual(plain(h.frontmatters.get(file.path)), {title:'Keep'});
  assert.equal(h.contents.get(file.path), '#body');
});

test('note tag save accepts concurrent unrelated property changes', async () => {
  const h = await harness(), file = h.add('Note.md', 'body', {tags:['old'], status:'draft'});
  h.plugin.editNote(file);
  h.frontmatters.get(file.path).status = 'reviewed';
  await h.modals.at(-1).onSave(['new']);
  assert.deepEqual(plain(h.frontmatters.get(file.path)), {tags:['new'], status:'reviewed'});
});

test('note tag save refuses concurrent tag changes and preserves them', async () => {
  const h = await harness(), file = h.add('Note.md', 'body', {tags:['old']});
  h.plugin.editNote(file);
  h.frontmatters.get(file.path).tags = ['other'];
  await assert.rejects(h.modals.at(-1).onSave(['new']), /태그가 변경/);
  assert.deepEqual(h.frontmatters.get(file.path).tags, ['other']);
});

test('note modal cannot write to a deleted-and-replaced file', async () => {
  const h = await harness(), file = h.add('Note.md', 'body', {tags:['old']});
  h.plugin.editNote(file); h.add('Note.md', 'replacement', {tags:['other']});
  await assert.rejects(h.modals.at(-1).onSave(['new']), /삭제/);
  assert.deepEqual(h.frontmatters.get(file.path).tags, ['other']);
});

test('link modal refuses a concurrent disk edit without replacing its contents', async () => {
  const h = await harness(), snapshot = '[[Note]] {#old}\nUnchanged';
  const file = h.add('Source.md', snapshot);
  h.plugin.editLink(file, snapshot, Core.parseDocument(snapshot).links[0], null);
  const concurrent = snapshot + '\nUser addition'; h.contents.set(file.path, concurrent);
  await assert.rejects(h.modals.at(-1).onSave(['new']), /내용이 변경/);
  assert.equal(h.contents.get(file.path), concurrent);
});

test('link save changes only the selected repeated occurrence', async () => {
  const h = await harness(), snapshot = '[[Note]] {#first}\n[[Note]] {#second}\nKeep';
  const file = h.add('Source.md', snapshot);
  h.plugin.editLink(file, snapshot, Core.parseDocument(snapshot).links[1], null);
  await h.modals.at(-1).onSave(['changed']);
  assert.equal(h.contents.get(file.path), '[[Note]] {#first}\n[[Note]] {#changed}\nKeep');
});

test('source-editor tag save is a localized change and preserves surrounding text', async () => {
  const h = await harness(), snapshot = '😀 시작\n[[문서]] {#기존}\nKeep';
  const file = h.add('Source.md', snapshot), editor = editorFor(snapshot);
  h.workspace.leaves = [{view:{file, editor, getMode:() => 'source'}}];
  h.plugin.editLink(file, snapshot, Core.parseDocument(snapshot).links[0], editor);
  await h.modals.at(-1).onSave(['새태그']);
  assert.equal(editor.getValue(), '😀 시작\n[[문서]] {#새태그}\nKeep');
  assert.equal(editor.changes.length, 1);
  assert.ok(editor.changes[0].start > snapshot.indexOf('[[문서]]'));
});

test('source-editor tag save refuses a concurrent edit', async () => {
  const h = await harness(), snapshot = '[[Note]] {#old}';
  const file = h.add('Source.md', snapshot), editor = editorFor(snapshot);
  h.workspace.leaves = [{view:{file, editor, getMode:() => 'source'}}];
  h.plugin.editLink(file, snapshot, Core.parseDocument(snapshot).links[0], editor);
  editor.setValue(snapshot + '\nAdded');
  await assert.rejects(h.modals.at(-1).onSave(['new']), /내용이 변경/);
  assert.equal(editor.getValue(), snapshot + '\nAdded'); assert.equal(editor.changes.length, 0);
});

test('source-editor tag save refuses writing into a tab switched to another file', async () => {
  const h = await harness(), snapshot = '[[Note]] {#old}';
  const file = h.add('Source.md', snapshot), other = h.add('Other.md', snapshot), editor = editorFor(snapshot);
  const view = {file, editor, getMode:() => 'source'}; h.workspace.leaves = [{view}];
  h.plugin.editLink(file, snapshot, Core.parseDocument(snapshot).links[0], editor);
  view.file = other;
  await assert.rejects(h.modals.at(-1).onSave(['new']), /내용이 변경/);
  assert.equal(editor.getValue(), snapshot); assert.equal(editor.changes.length, 0);
});
