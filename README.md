# Optical Disc to Jellyfin Pipeline

## Warning

This whole project is AI vibecoded slop and should be treated as such.

Do not assume the architecture, code quality, error handling, metadata logic, or operational safety are production-ready just because the repository exists and appears to run. It may contain bad assumptions, brittle behavior, missing edge cases, and outright mistakes.

The episode matching is especially untrustworthy. It can guess wrong, mislabel episodes, skip the wrong title, or produce output that needs manual review. Do not trust this project blindly with irreplaceable media, your only copy of a disc, or a production Jellyfin library unless you are prepared to verify the results yourself.

macOS-first CLI daemon that watches for optical disc insertion, rips titles with MakeMKV, maps them to episodes with OpenAI + TMDb, transcodes them with HandBrakeCLI, and moves the final files into a Jellyfin-compatible library layout.

## Commands

```bash
cp .env.example .env
cp config.example.yaml config.yaml
npm install
npm run install:deps
npm run build
node dist/src/cli/index.js validate-config --config ./config.yaml
node dist/src/cli/index.js dry-run-match --config ./config.yaml --disc-label "DISC_1" --titles-json ./titles.json
node dist/src/cli/index.js watch --config ./config.yaml
```

You can also run the dependency installer directly:

```bash
bash ./scripts/install-deps.sh
```

## Config

Copy [config.example.yaml](/Users/jlcd/Documents/projects/Piracy-Automation-pipeline/config.example.yaml) to `config.yaml` and set:

- `series.show_title`
- `series.season_number`
- `paths.library_root`
- `openai.api_key`
- `tmdb.api_key`
- `makemkv.binary_path`
- `handbrake.binary_path`
- `ffprobe.binary_path`
- `matching.stitched_title_multiplier`

API keys can be written inline or referenced as `env:VARIABLE_NAME`.

Example environment file:

- [`.env.example`](/Users/jlcd/Documents/projects/Piracy-Automation-pipeline/.env.example)

If you use environment variables, keep these lines in `config.yaml`:

```yaml
openai:
  api_key: "env:OPENAI_API_KEY"

tmdb:
  api_key: "env:TMDB_API_KEY"
```

Load `.env` into your shell before starting the app:

```bash
export $(grep -v '^#' .env | xargs)
```

Homebrew-installed binaries on this machine are:

- `makemkvcon`: `/opt/homebrew/bin/makemkvcon`
- `HandBrakeCLI`: `/opt/homebrew/bin/HandBrakeCLI`
- `ffprobe`: `/opt/homebrew/bin/ffprobe`

## Notes

- The watcher is macOS-specific and uses `drutil` polling.
- Only one optical drive and one configured show/season are supported in v1.
- Source MKVs are deleted only after a verified HandBrake output has been moved into the destination library.
