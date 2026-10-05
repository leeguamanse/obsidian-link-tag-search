# Changelog

## 0.1.0

Initial release.

- Add a dedicated search view for notes and individual links, with tag queries and note/link filters.
- Edit note tags using Obsidian's native `tags` property.
- Store tags for each link occurrence in a same-line `{#tag}` group.
- Support internal links, inline Markdown links, angle-bracket web links, and plain HTTP/HTTPS URLs.
- Open a search result at its source and provide separate actions to open its destination.
- Refresh the search index when notes change, move, or are deleted.
- Preserve unrelated content and reject edits when their original content has changed.
- Include Korean interface text, automated tests, and manual installation instructions.

Mobile devices and large vaults have not yet been tested. Reference-style links, multiline links, and some complex nested Markdown code structures are not fully supported.
