'use strict';

// Shared first-run copy for pinned documentation and newly built releases.
const commands = lines => '```sh\n' + lines.join('\n') + '\n```';
const instructions = ({ cli, starter, onboarding, grouped = false }) => ({
  install: commands([
    `npm install --save-dev ${cli}`,
    `npx --no-install ashfox ${onboarding ? '--version' : 'capabilities'}`
  ]),
  start: onboarding
    ? 'Create the bundled starter offline and export your first item:\n\n' + commands([
      'npx --no-install ashfox init assets',
      `npx --no-install ashfox export assets/${grouped ? 'asset/items/' : ''}sword.ashfox --output sword.png`
    ])
    : `Download and extract the [starter assets](${starter}), then run the install\ncommand above inside that folder:\n\n` + commands([
      'npx --no-install ashfox export sword.ashfox --output sword.png'
    ]),
  check: onboarding
    ? 'The second command prints the installed product version. Run\n`npx --no-install ashfox doctor` to check optional Chrome and FFmpeg support.'
    : 'The second command prints `ok: true` and the supported commands.',
  offline: commands([
    'npm install --offline --save-dev ./tools/ashfox-cli.tgz',
    `npx --no-install ashfox ${onboarding ? '--version' : 'capabilities'}`
  ]),
  availability: onboarding
    ? 'The stable CLI includes help, version, environment checks and offline starter creation.'
    : '`--help`, `--version`, `doctor` and `init` are available in development builds.\nThe published 1.0.0 package uses the starter ZIP workflow in the installation guide.'
});

module.exports = { instructions };
