# Stdio and in-memory workflows

Use raw stdout for a single result or JSON-lines for a persistent session. Source
files are optional: send complete source text and its module graph from memory.
Install the CLI first; commands below use the [starter assets](install.md).

## Inputs and outputs

```sh
# Native source from stdin; self-contained or paired with a memory graph below.
cat marker.ashfox | npx --no-install ashfox capture --stdin --name marker.ashfox > marker.png

# View an existing PNG, without converting it into an Ashfox project.
npx --no-install ashfox export sword.ashfox --output sword.png
npx --no-install ashfox capture sword.png --scale 16 --background checker > sword-large.png
cat sword.png | npx --no-install ashfox capture --stdin --input-format png --scale 16 > large.png

# Explicit saving. Existing destinations are rejected, never overwritten.
npx --no-install ashfox capture fox.ashfox --output fox.png
```

When no filename is given and stdin is piped, native source input is the default;
`--stdin` makes this explicit. File inputs resolve relative imports beneath the entry's directory. Memory source
inputs do not read sibling files or the current directory. For imports, use
`--input-json` with this closed object on stdin:

```json
{
  "name": "main.ashfox",
  "source": "ashfox-model 1\nasset example { ... }",
  "files": { "shared.ashfox": "ashfox-model 1\nmodule shared { ... }" }
}
```

This JSON illustrates the transport shape; replace the abbreviated strings with
complete source texts. `name` defaults to `main.ashfox`. Every supplied module
must be reachable. Absolute paths, escaping imports, duplicate entry files and
remote/package imports are rejected. The same `input` object is accepted by the
persistent session. `{ "file": "fox.ashfox" }` selects a file instead;
`{ "png": "<base64 PNG>" }` selects a PNG already held in memory.

Stdout contains only the requested result. Diagnostics go to stderr and a failed
command exits nonzero without emitting a partial image. Binary output to a TTY is
rejected: pipe it, redirect it, or use `--output`. Shell redirection itself creates
a file even if the command fails; check the exit code before consuming it.

A Node consumer can keep the entire result in memory:

```js
const { execFileSync } = require('node:child_process');
const cli = require('node:path').resolve('node_modules/@ashfox/cli/dist/ashfox.cjs');
const png = execFileSync(process.execPath, [cli, 'capture', 'fox.ashfox',
  '--azimuth', '45', '--elevation', '20'], { maxBuffer: 64 * 1024 * 1024 });
// png is a Buffer. Pass it to your image viewer, agent tool or upload adapter.
```

## Keep a persistent stdio session

Start `ashfox stdio`. Send one JSON request per line; read one JSON response per
line. Request IDs are nonempty strings and must be unique among pending requests.
Up to eight requests may be queued. Operations execute in order; `cancel` can
interrupt the currently executing request immediately.

```json
{"id":"1","method":"load","params":{"input":{"file":"fox.ashfox"}}}
{"id":"2","method":"view","params":{"options":{"azimuth":45,"elevation":20}}}
{"id":"3","method":"capture","params":{}}
{"id":"4","method":"inspect","params":{}}
```

Responses use `format: ashfox-observer`, `version: 1`, the matching `id`, `ok`,
and either `result` or `error` (`code`, `message`). Media results contain the
source `revision`, `mime`, `encoding: base64`, `data`, `byteLength` and the raw
hex SHA-256 digest. Binary frames are not mixed into this JSON-lines transport.
Decode the base64 in your host process; no output file is needed.

| Method | Parameters |
| --- | --- |
| `capabilities` | `{}`; discover methods, output kinds and limits |
| `load` | `{input}` initially; `{input, expectedRevision}` when replacing the current asset |
| `source` | `{}`; get the loaded source graph and revision |
| `inspect`, `capture`, `replay`, `export` | `{options?, expectedRevision?, reset?}`; options use camelCase JSON keys corresponding to CLI flags |
| `view` | `{options?, reset?}`; persist view settings for subsequent operations |
| `cancel` | `{id}` identifying the active request; returns `cancelled: true/false` |
| `close` | `{}`; release the model and renderer; the transport remains open for another `load` |

`textures: false` corresponds to `--no-textures`; booleans are JSON booleans.
`reset: true` starts options from defaults. Per-operation options are temporary;
only `view` persists them. Use `reset` to clear an earlier clip, node or texture
selection. A successful load resets the view. Invalid, stale or cancelled loads
preserve the previous asset. Capture is read-only and needs no acceptance step.

Replacing the complete source graph is the edit operation: request `source`,
modify its texts in your process, then call `load` with the current
`expectedRevision`. There is no independent geometry or raster mutation API.
Browser file pickers, project storage and human review UI are not protocol
operations. The shared model renderer and deterministic build replay are the
same implementation used by the browser.

EOF drains queued requests and releases resources. SIGINT/SIGTERM cancels work
and exits; request-level cancellation keeps the transport usable. Compilation
runs in a bounded worker (120 seconds, 256 MiB V8 old-generation heap); renderer
requests have a 120-second timeout. Media is limited to 32 MiB and input lines to
16 MiB. The browser memory footprint is separate from the compiler heap limit.
Image byte equality across different Chrome/GPU versions is not guaranteed;
pin the renderer environment for image regression tests.

## Run a complete client

Download [the Node client](/downloads/stdio-client.zip), extract `client.mjs`
into your asset folder (beside `package.json`), then run:

```sh
node client.mjs fox.ashfox > client-view.png
node client.mjs fox.ashfox --cancel-demo > recovered-view.png
```

Use a shell that preserves binary redirection, or collect the child process's
stdout as bytes. The client itself keeps media in a Buffer; the redirect is only
a convenient way to inspect its output. See [platform notes](install.md#shells-and-binary-output).

The client starts `ashfox stdio`, loads source, reads its graph, replaces it in
memory with an expected revision, captures and verifies the returned media hash,
then closes cleanly. Its sample edit appends a newline; replace that edit with
your application's source change. `--cancel-demo` interrupts a request and
captures again to demonstrate recovery. Responses are matched by ID, errors
reject their requests, and process exit/timeouts reject outstanding work.
The original source files are not written.
