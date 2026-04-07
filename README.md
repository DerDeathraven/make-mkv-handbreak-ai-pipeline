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
node dist/src/cli/index.js smoke-test --config ./config.yaml
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

## External Services

### OpenAI

The OpenAI connection is used for episode guessing.

After the disc is ripped, the app sends OpenAI a structured summary of the ripped titles, including:

- the disc label
- each file's runtime
- each file's order on the disc
- the configured show and season
- the candidate episode list for that season

OpenAI then returns a best-guess mapping that says whether each ripped file is:

- a normal episode
- a multi-episode file
- an extra
- unmapped

That response is used to build the final Jellyfin-style filenames and folder paths. This is only a guess layer, not a trusted metadata source.

### TMDb

The TMDb connection is used as the season metadata source.

The app looks up the configured show and season on TMDb and pulls episode data such as:

- episode number
- episode title
- runtime when available
- season ordering

That metadata is used for two things:

- giving OpenAI better context so it can guess the episode mapping
- helping the rip stage skip obviously giant stitched-together compilation titles before ripping them

TMDb does not do the final guessing itself. It provides the candidate season data that the rest of the pipeline works from.

## Notes

- The watcher is macOS-specific and uses `drutil` polling.
- Only one optical drive and one configured show/season are supported in v1.
- Source MKVs are deleted only after a verified HandBrake output has been moved into the destination library.
