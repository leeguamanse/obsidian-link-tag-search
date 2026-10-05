# Link Tag Search

Tag individual links and notes, then find them together in a dedicated Obsidian search view. Link tags are stored as readable text beside each link, so two links to the same destination can have different tags.

Requires Obsidian 1.13.7 or later. The interface and command names in this initial release are in Korean. The plugin uses Obsidian's native `tags` property for note tags and leaves its built-in search unchanged. Desktop use has been tested on Windows with Obsidian 1.13.7; mobile devices have not yet been tested.

```markdown
[[회의록|예산 검토]] {#예산 #검토}
[[회의록|다음 회의]] {#일정}
[Obsidian Help](https://help.obsidian.md/) {#자료}
```

Searching for `#예산` returns the first link as an individual link result. It can also return the containing note, because the note contains that tag.

## Install from a release

1. Open this repository's **Releases** page and choose a release.
2. Download its `main.js`, `manifest.json`, and `styles.css` assets. The source-code ZIP alone is not an installable plugin.
3. Create `<your-vault>/.obsidian/plugins/link-tag-search/` and place the three files directly in that folder.
4. Reload Obsidian. In **Settings → Community plugins**, enable **Link Tag Search**. Review any plugin trust prompt yourself.

For another device, install the same release in that device's vault. Tags travel with the Markdown notes when those notes are copied or synced. This plugin does not provide its own synchronization service. If updating an existing installation, back up the old plugin files before replacing them.

This README describes manual installation; it does not imply that the plugin has been accepted into Obsidian's community plugin directory.

## 사용법

명령어 팔레트(`Ctrl+P`, macOS에서는 `Cmd+P`)에서 다음 명령을 실행합니다.

- **Link Tag Search: 태그 통합 검색 열기** — 검색창을 엽니다. 왼쪽 리본의 태그 아이콘으로도 열 수 있습니다.
- **Link Tag Search: 현재 노트 태그 편집** — 현재 노트의 `tags` 속성을 편집합니다.
- **Link Tag Search: 현재 노트의 링크 태그 편집** — 선택한 링크 옆에 태그를 저장합니다.

링크 안에 커서를 놓으면 해당 링크를 선택합니다. 커서가 링크 밖에 있어도 현재 줄에 링크가 하나이면 그 링크를 선택하고, 그 외에는 노트의 링크 목록을 엽니다. 편집기 우클릭 메뉴와 검색 결과의 **태그 편집** 버튼도 사용할 수 있습니다.

### 노트 태그

노트 태그는 기본 `tags` 속성에 저장됩니다.

```yaml
---
tags:
  - 업무
  - 예산
---
```

본문의 `#태그`도 검색에 포함됩니다. 본문에 직접 쓴 태그는 본문에서 수정하세요. 노트 태그 편집은 다른 속성과 본문을 유지합니다.

### 개별 링크 태그

링크 바로 뒤, 같은 줄에 `{#태그 #다른태그}`를 저장합니다.

```markdown
[[프로젝트|예산 계획]] {#예산 #검토}
[[프로젝트|나중에 읽을 계획]] {#읽을거리}
[공식 도움말](https://help.obsidian.md/) {#자료 #참고}
https://example.com {#읽을거리}
```

같은 목적지를 가리키더라도 각 위치의 링크에 별도 태그를 붙일 수 있습니다. 링크의 태그는 연결된 대상 노트의 `tags` 속성을 바꾸지 않으며, 대상 노트의 태그를 자동으로 상속하지도 않습니다. 링크 태그 편집창에서 태그를 모두 지우고 저장하면 그 링크의 태그 묶음이 제거됩니다.

### 검색

전용 **태그 통합 검색** 창은 노트 제목·경로·본문과 링크 제목·주소·태그를 검색합니다.

| 검색어 | 동작 |
| --- | --- |
| `예산` | 해당 단어를 포함한 노트 또는 링크 |
| `#예산` | `예산` 태그 또는 `예산/계획` 같은 하위 태그 |
| `tag:#예산` | 위와 같은 태그 검색 |
| `예산 검토` | 두 검색어를 모두 포함한 결과 |
| `"회의 기록"` | 공백을 포함한 구문 검색 |

**전체 / 노트 / 링크** 버튼으로 결과 종류를 고릅니다. 태그를 누르면 그 태그로 다시 검색합니다. 결과 제목을 누르면 원본 노트로 이동하며, 링크 결과에서는 해당 줄을 강조합니다. **연결된 노트 열기** 또는 **웹 링크 열기** 버튼은 링크의 목적지를 엽니다.

Obsidian 기본 검색의 `tag:#예산`으로도 태그가 들어 있는 노트를 찾을 수 있습니다. 개별 링크를 별도 결과로 표시하는 기능은 이 플러그인의 전용 검색창에서 제공합니다. 기본 빠른 전환기와 `[[링크]]` 자동 완성의 동작은 변경하지 않습니다.

## 지원 범위와 제한

- 내부 `[[링크]]`, `[제목](주소)`, `<https://주소>`, 본문의 `http`/`https` 주소를 지원합니다.
- 이미지·임베드, 코드, 주석은 링크 태그 대상으로 처리하지 않습니다.
- 참조형 링크(`[제목][참조]`), 줄을 넘기는 링크, 복잡하게 중첩된 Markdown 목록 안의 코드 구문은 완전히 지원하지 않습니다.
- 기본 검색의 `OR`, 정규식, 속성 연산자 전체 문법은 구현하지 않습니다.
- 모바일 실기기와 대규모 보관함에서는 아직 검증하지 않았습니다.

## 개인정보와 저장 방식

플러그인은 노트 데이터를 외부 서버로 보내지 않습니다. 텔레메트리, 광고, 계정 등록, 유료 기능이 없으며 보관함 외부 파일에 접근하지 않습니다. 검색 목록은 메모리에 만들고, 태그를 저장하면 해당 Markdown 파일을 수정합니다. 사용자가 **웹 링크 열기**를 누르면 선택한 웹사이트가 열립니다.

편집창을 연 뒤 노트의 관련 내용이 바뀌면 오래된 내용으로 덮어쓰지 않고 편집창을 다시 열도록 안내합니다. 플러그인을 꺼도 노트의 `tags` 속성과 링크 옆의 태그 문자는 그대로 남습니다.

## Build and test

Use a current Node.js LTS release. From the repository root, run:

```sh
node build.cjs
node --test test/core.test.js test/plugin.test.js
```

No npm dependency installation is needed. The build writes `main.js`, `manifest.json`, and `styles.css` to `dist/`. Copy those files into a test vault's `.obsidian/plugins/link-tag-search/` directory to try a development build.

The tests cover parsing and tag matching, separate tags for repeated links, code exclusions, edits that preserve unrelated content, stale-edit protection, and index changes during asynchronous reads. Actual app testing used a separate Windows test vault. See [VERIFICATION.txt](VERIFICATION.txt) for the recorded validation scope.

## License

[MIT](LICENSE)
