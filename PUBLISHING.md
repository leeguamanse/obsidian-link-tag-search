# Publishing

The repository contains dependency-free source and a reproducible Node.js build.
Do not include the local test vault or files from a personal vault in a release.

## Release

1. Update `manifest.json` and `package.json` to the same `x.y.z` version.
2. Add that version and its minimum app version to `versions.json`.
3. Update `CHANGELOG.md` and `RELEASE_NOTES.md`.
4. Run `node --test test/core.test.js test/plugin.test.js` and `node build.cjs`.
5. Commit and push the source, then push a tag that exactly matches the version,
   without a leading `v`.
6. The release workflow tests and builds the tagged source, attests the three
   assets, and creates a draft release. Inspect the workflow and assets, then
   publish the release.

The release must provide `main.js`, `manifest.json`, and `styles.css` as individual
assets. The automatic GitHub source-code archives are not sufficient.

## Initial directory submission

Follow the current [official submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin).

1. Sign in at the Obsidian Community directory with an Obsidian account.
2. Link the GitHub account that owns this repository.
3. In **Plugins → New plugin**, enter the public repository URL and choose its owner.
4. Review the developer policies and support commitment before submitting.
5. Address review feedback and publish the listing after its checks pass.

The directory reads the manifest on the repository's default branch and installs
assets from the matching release tag. Keep both consistent. Publishing a GitHub
repository alone does not list the plugin in Obsidian's in-app directory.

Until the listing is accepted, users can install a published release manually
using the instructions in [README.md](README.md).
