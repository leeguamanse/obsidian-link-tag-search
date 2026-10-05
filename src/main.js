const { Plugin, ItemView, Modal, Setting, Notice, TFile, MarkdownView, getAllTags } = require('obsidian');
const VIEW = 'link-tag-search-view';

function tagsOf(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/) : [];
  const result = [];
  for (const item of values) {
    if (typeof item !== 'string') continue;
    try { result.push(...Core.splitTags(item)); } catch { /* Ignore malformed existing properties. */ }
  }
  return [...new Map(result.map(t => [t.normalize('NFC').toLowerCase(), t])).values()];
}

function applyEditorChange(editor, before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  editor.replaceRange(after.slice(start, newEnd), editor.offsetToPos(start), editor.offsetToPos(oldEnd));
}

class TagModal extends Modal {
  constructor(app, title, context, tags, onSave, help = '') {
    super(app); Object.assign(this, {title, context, tags, onSave, help});
  }
  onOpen() {
    this.titleEl.setText(this.title);
    this.contentEl.addClass('lts-modal');
    this.contentEl.createEl('p', {text:this.context, cls:'lts-muted'});
    const label = this.contentEl.createEl('label', {text:'태그 (공백이나 쉼표로 구분)'});
    const input = this.contentEl.createEl('input', {type:'text', cls:'lts-tag-input'});
    input.setAttribute('aria-label', '태그');
    input.value = this.tags.map(t => '#' + t).join(' ');
    input.placeholder = '#자료 #예산 #읽을거리';
    label.appendChild(input);
    this.contentEl.createEl('p', {text:this.help || '태그를 모두 지우고 저장하면 이 링크의 태그가 제거됩니다.', cls:'lts-muted'});
    const error = this.contentEl.createEl('p', {cls:'lts-error'});
    error.setAttribute('role', 'alert');
    let saving = false;
    const save = async () => {
      if (saving) return;
      try {
        const tags = Core.splitTags(input.value);
        saving = true; saveButton.setDisabled(true); error.setText('');
        await this.onSave(tags);
        this.close();
      } catch (e) {
        error.setText(e.message || String(e));
      } finally { saving = false; saveButton.setDisabled(false); }
    };
    let saveButton;
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText('취소').onClick(() => this.close()))
      .addButton(b => { saveButton = b; b.setButtonText('저장').setCta().onClick(save); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void save(); } });
    input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  }
  onClose() { this.contentEl.empty(); }
}

class LinkPicker extends Modal {
  constructor(plugin, file, text, links, editor) { super(plugin.app); Object.assign(this, {plugin, file, text, links, editor}); }
  onOpen() {
    this.titleEl.setText('태그를 편집할 링크 선택');
    this.contentEl.addClass('lts-modal');
    this.contentEl.createEl('p', {text:this.file.path, cls:'lts-muted'});
    const list = this.contentEl.createDiv('lts-picker');
    for (const link of this.links) {
      const button = list.createEl('button', {cls:'lts-picker-item'});
      button.createSpan({text:link.label || link.target});
      button.createEl('small', {text:`${link.line + 1}행 · ${link.target}`});
      button.addEventListener('click', () => { this.close(); this.plugin.editLink(this.file, this.text, link, this.editor); });
    }
  }
  onClose() { this.contentEl.empty(); }
}

class TagSearchView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.query = ''; this.scopeFilter = 'all'; this.limit = 100; }
  getViewType() { return VIEW; }
  getDisplayText() { return '태그 통합 검색'; }
  getIcon() { return 'tags'; }
  getState() { return {query:this.query, scope:this.scopeFilter}; }
  async setState(state, result) {
    if (state && typeof state.query === 'string') this.query = state.query;
    if (state && ['all','note','link'].includes(state.scope)) this.scopeFilter = state.scope;
    if (this.input) { this.input.value = this.query; this.renderResults(); }
    await super.setState(state, result);
  }
  async onOpen() {
    this.contentEl.empty(); this.contentEl.addClass('lts-view');
    const heading = this.contentEl.createDiv('lts-heading');
    heading.createEl('h3', {text:'태그 통합 검색'});
    const refresh = heading.createEl('button', {text:'새로고침', cls:'lts-small'});
    refresh.addEventListener('click', () => void this.plugin.rebuild());
    this.contentEl.createEl('p', {text:'노트와 링크를 태그로 연결해 찾아보세요.', cls:'lts-muted'});
    this.input = this.contentEl.createEl('input', {type:'search', cls:'lts-search'});
    this.input.placeholder = '검색어 또는 #태그'; this.input.value = this.query;
    this.input.setAttribute('aria-label', '태그 통합 검색어');
    this.input.addEventListener('input', () => {
      this.query = this.input.value; this.limit = 100;
      window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.renderResults(), 100);
    });
    const controls = this.contentEl.createDiv('lts-controls');
    this.filterButtons = [];
    for (const [id, label] of [['all','전체'],['note','노트'],['link','링크']]) {
      const b = controls.createEl('button', {text:label});
      b.dataset.scope = id;
      b.addEventListener('click', () => { this.scopeFilter = id; this.limit = 100; this.renderResults(); });
      this.filterButtons.push(b);
    }
    this.statusEl = this.contentEl.createDiv('lts-status'); this.statusEl.setAttribute('aria-live','polite');
    this.resultsEl = this.contentEl.createDiv('lts-results');
    this.contentEl.createEl('p', {text:'일반 단어: 제목·본문·주소·태그 / #태그: 태그만 / 여러 단어: 모두 포함', cls:'lts-help'});
    this.unsubscribe = this.plugin.subscribe(() => {
      window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.renderResults(), 100);
    });
    this.renderResults();
  }
  async onClose() { window.clearTimeout(this.timer); this.unsubscribe?.(); this.contentEl.empty(); }
  focusSearch(query) {
    if (typeof query === 'string') { this.query = query; this.input.value = query; this.limit = 100; this.renderResults(); }
    this.input.focus(); this.input.select();
  }
  renderResults() {
    if (!this.resultsEl) return;
    this.filterButtons.forEach(b => { const selected = b.dataset.scope === this.scopeFilter; b.toggleClass('is-active', selected); b.setAttribute('aria-pressed', String(selected)); });
    this.resultsEl.empty();
    const entries = this.plugin.entries().filter(e => this.scopeFilter === 'all' || e.kind === this.scopeFilter);
    const matches = Core.searchEntries(entries, this.query);
    this.statusEl.setText(`${this.plugin.index.size}개 노트 · 결과 ${matches.length}개${this.plugin.indexing ? ' · 검색 목록 갱신 중…' : ''}${this.plugin.errors ? ` · 읽지 못한 노트 ${this.plugin.errors}개` : ''}`);
    if (!matches.length) {
      this.resultsEl.createEl('p', {text:this.plugin.indexing ? '노트를 읽는 중입니다…' : '검색 결과가 없습니다. 태그나 검색어를 바꿔보세요.', cls:'lts-empty'});
      return;
    }
    for (const {entry} of matches.slice(0, this.limit)) this.renderEntry(entry);
    if (matches.length > this.limit) {
      const more = this.resultsEl.createEl('button', {text:`100개 더 보기 (${matches.length - this.limit}개 남음)`, cls:'lts-more'});
      more.addEventListener('click', () => { this.limit += 100; this.renderResults(); });
    }
  }
  renderEntry(entry) {
    const card = this.resultsEl.createDiv('lts-result');
    const top = card.createDiv('lts-result-top');
    top.createSpan({text:entry.kind === 'note' ? '노트' : '링크', cls:'lts-kind'});
    const title = top.createEl('button', {text:entry.title, cls:'lts-result-title'});
    title.addEventListener('click', () => void this.plugin.openSource(entry));
    card.createEl('div', {text:entry.path + (entry.kind === 'link' ? ` · ${entry.line + 1}행` : ''), cls:'lts-path'});
    if (entry.kind === 'link') card.createEl('div', {text:entry.target, cls:'lts-target'});
    if (entry.tags.length) {
      const group = card.createDiv('lts-tags');
      for (const tag of entry.tags) {
        const b = group.createEl('button', {text:'#' + tag, cls:'lts-tag'});
        b.addEventListener('click', () => this.focusSearch('#' + tag));
      }
    }
    const actions = card.createDiv('lts-actions');
    const edit = actions.createEl('button', {text:'태그 편집', cls:'lts-small'});
    edit.addEventListener('click', () => void this.plugin.editEntry(entry));
    if (entry.kind === 'link') {
      const open = actions.createEl('button', {text:entry.link.kind === 'external' ? '웹 링크 열기 ↗' : '연결된 노트 열기', cls:'lts-small'});
      open.addEventListener('click', () => {
        if (entry.link.kind === 'external' && /^https?:\/\//i.test(entry.target)) window.open(entry.target, '_blank', 'noopener,noreferrer');
        else if (entry.link.kind === 'internal') void this.app.workspace.openLinkText(entry.target, entry.path, true);
      });
    }
  }
}

module.exports = class LinkTagSearch extends Plugin {
  async onload() {
    this.index = new Map(); this.versions = new Map(); this.listeners = new Set(); this.disposed = false; this.errors = 0;
    this.registerView(VIEW, leaf => new TagSearchView(leaf, this));
    this.addRibbonIcon('tags', '태그 통합 검색', () => void this.openSearch());
    this.addCommand({id:'open-search', name:'태그 통합 검색 열기', callback:() => void this.openSearch()});
    this.addCommand({id:'edit-note-tags', name:'현재 노트 태그 편집', checkCallback:checking => {
      const file = this.app.workspace.getActiveFile();
      if (!file || file.extension !== 'md') return false;
      if (!checking) this.editNote(file); return true;
    }});
    this.addCommand({id:'edit-link-tags', name:'현재 노트의 링크 태그 편집', checkCallback:checking => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) return false;
      if (!checking) void this.chooseLink(view); return true;
    }});
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile && file.extension === 'md') menu.addItem(item => item.setTitle('노트 태그 편집').setIcon('tags').onClick(() => this.editNote(file)));
    }));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, view) => {
      if (view.file?.extension !== 'md') return;
      menu.addItem(item => item.setTitle('링크 태그 편집').setIcon('tags').onClick(() => void this.chooseLink(view, editor)));
      menu.addItem(item => item.setTitle('노트 태그 편집').setIcon('tag').onClick(() => this.editNote(view.file)));
    }));
    this.registerEvent(this.app.metadataCache.on('changed', file => void this.refreshFile(file)));
    this.registerEvent(this.app.vault.on('delete', file => { this.invalidate(file.path); this.emit(); }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.invalidate(oldPath);
      if (file instanceof TFile) void this.refreshFile(file); else void this.rebuild();
    }));
    this.app.workspace.onLayoutReady(() => { if (!this.disposed) void this.rebuild(); });
  }
  onunload() { this.disposed = true; this.listeners.clear(); this.index.clear(); this.versions.clear(); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { if (!this.disposed) for (const fn of this.listeners) fn(); }
  invalidate(path) {
    for (const key of [...this.index.keys()]) if (key === path || key.startsWith(path + '/')) { this.index.delete(key); this.versions.set(key, (this.versions.get(key) || 0) + 1); }
    this.versions.set(path, (this.versions.get(path) || 0) + 1);
  }
  entries() { return [...this.index.values()].flatMap(v => v.entries); }
  async refreshFile(file) {
    if (this.disposed || !(file instanceof TFile) || file.extension !== 'md') return;
    const path = file.path, version = (this.versions.get(path) || 0) + 1;
    this.versions.set(path, version);
    try {
      const text = await this.app.vault.cachedRead(file);
      if (this.disposed || this.versions.get(path) !== version || file.path !== path || this.app.vault.getAbstractFileByPath(path) !== file) return;
      const parsed = Core.parseDocument(text);
      const cache = this.app.metadataCache.getFileCache(file);
      const tags = tagsOf([...(cache ? getAllTags(cache) || [] : []), ...parsed.inlineTags]);
      const entries = [{id:path, kind:'note', title:file.basename, path, body:text, tags}];
      for (const link of parsed.links) entries.push({id:`${path}:${link.start}`, kind:'link', title:link.label || link.target, path, target:link.target, tags:link.tags, line:link.line, link});
      this.index.set(path, {text, entries}); this.emit();
    } catch (e) { this.errors++; this.emit(); console.error('Link Tag Search: indexing failed', path, e); }
  }
  async rebuild() {
    if (this.disposed) return;
    if (this.indexing) { this.rebuildRequested = true; return; }
    this.indexing = true; this.errors = 0; this.emit();
    try {
      do {
        this.rebuildRequested = false;
        const files = this.app.vault.getMarkdownFiles();
        const live = new Set(files.map(f => f.path));
        for (const path of this.index.keys()) if (!live.has(path)) this.invalidate(path);
        let count = 0;
        for (const file of files) {
          if (this.disposed) break;
          await this.refreshFile(file);
          if (++count % 25 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
        }
      } while (this.rebuildRequested && !this.disposed);
    } finally { this.indexing = false; this.emit(); }
  }
  async openSearch(query) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false) || this.app.workspace.getLeaf('tab'); await leaf.setViewState({type:VIEW, active:true}); }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof TagSearchView) leaf.view.focusSearch(query);
  }
  async openSource(entry) {
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (!(file instanceof TFile)) { new Notice('노트가 이동되었거나 삭제되었습니다. 검색을 새로고침해 주세요.'); return; }
    const options = entry.kind === 'link' ? {eState:{line:entry.line, focus:true}} : {};
    await this.app.workspace.getLeaf(false).openFile(file, options);
  }
  editNote(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const initial = tagsOf(cache?.frontmatter?.tags);
    const initialKey = JSON.stringify(initial);
    new TagModal(this.app, '노트 태그 편집', file.path, initial, async tags => {
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error('노트가 이동되었거나 삭제되었습니다. 다시 열어 주세요.');
      await this.app.fileManager.processFrontMatter(file, fm => {
        if (JSON.stringify(tagsOf(fm.tags)) !== initialKey) throw new Error('다른 곳에서 태그가 변경되었습니다. 이 창을 닫고 다시 열어 주세요.');
        if (tags.length) fm.tags = tags; else delete fm.tags;
      });
      new Notice('노트 태그를 저장했습니다.');
    }, '노트 속성의 tags를 편집합니다. 본문에 쓴 #태그는 본문에서 수정해 주세요.').open();
  }
  async chooseLink(view, passedEditor) {
    const file = view.file;
    if (!file) return;
    const editor = passedEditor || (view.getMode?.() === 'source' ? view.editor : null);
    let text;
    try { text = editor ? editor.getValue() : await this.app.vault.read(file); }
    catch { new Notice('노트를 읽을 수 없습니다. 노트가 이동되었거나 삭제되었는지 확인해 주세요.'); return; }
    const links = Core.parseDocument(text).links;
    if (!links.length) { new Notice('이 노트에서 내부 링크나 웹 링크를 찾지 못했습니다.'); return; }
    if (editor) {
      const pos = editor.getCursor(), offset = editor.posToOffset(pos);
      const current = links.find(l => offset >= l.start && offset <= (l.tagEnd ?? l.end));
      const sameLine = links.filter(l => l.line === pos.line);
      if (current || sameLine.length === 1) { this.editLink(file, text, current || sameLine[0], editor); return; }
    }
    new LinkPicker(this, file, text, links, editor).open();
  }
  editLink(file, snapshot, link, editor) {
    new TagModal(this.app, '링크 태그 편집', `${link.label || link.target} · ${file.path}:${link.line + 1}`, link.tags, async tags => {
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new Error('노트가 이동되었거나 삭제되었습니다. 다시 열어 주세요.');
      if (editor) {
        const view = this.app.workspace.getLeavesOfType('markdown').map(l => l.view).find(v => v.editor === editor && v.file === file);
        if (!view || editor.getValue() !== snapshot) throw new Error('노트 내용이 변경되었습니다. 이 창을 닫고 링크를 다시 선택해 주세요.');
        applyEditorChange(editor, snapshot, Core.replaceLinkTags(snapshot, link, tags));
      } else {
        await this.app.vault.process(file, current => {
          if (current !== snapshot) throw new Error('노트 내용이 변경되었습니다. 이 창을 닫고 링크를 다시 선택해 주세요.');
          return Core.replaceLinkTags(current, link, tags);
        });
      }
      new Notice('링크 태그를 저장했습니다.');
    }, '이 위치의 링크에만 적용됩니다. 예: [[노트]] {#자료 #읽기}').open();
  }
  async editEntry(entry) {
    try {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) throw new Error('노트가 이동되었거나 삭제되었습니다. 새로고침해 주세요.');
      if (entry.kind === 'note') { this.editNote(file); return; }
      const editorView = this.app.workspace.getLeavesOfType('markdown').map(l => l.view).find(v => v.file === file && v.getMode?.() === 'source');
      const editor = editorView?.editor || null;
      const text = editor ? editor.getValue() : await this.app.vault.read(file);
      const link = Core.parseDocument(text).links.find(l => l.start === entry.link.start && l.target === entry.target);
      if (!link) throw new Error('링크 위치가 변경되었습니다. 검색을 새로고침하고 다시 선택해 주세요.');
      this.editLink(file, text, link, editor);
    } catch (e) { new Notice(e.message || String(e)); }
  }
};
