import assert from 'node:assert/strict';

import { registerEndpointSettings } from '../src/plugin/endpointSettings';
import type { EndpointConfig } from '../src/plugin/types';

type SettingsRecord = Record<string, { value?: unknown; set?: (value: unknown) => void }>;

type MockSettingOptions = {
  name: string;
  category: string;
  plugin: string;
  type: 'text' | 'number';
  value: string | number;
  onChange: (next: unknown) => void;
};

const withEnv = (changes: Record<string, string | undefined>, run: () => void) => {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(changes)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const createSettingCtor = (settings: SettingsRecord) => {
  return class MockSetting {
    value: unknown;

    constructor(id: string, options: MockSettingOptions) {
      // Emulate a host that writes constructor defaults on registration,
      // which can clobber persisted values unless plugin hydrates first.
      this.value = options.value;
      settings[id] = {
        value: this.value,
        set: (next: unknown) => {
          this.value = next;
          settings[id].value = next;
          options.onChange(next);
        }
      };
    }
  };
};

withEnv(
  {
    ASHFOX_HOST: undefined,
    ASHFOX_PORT: undefined,
    ASHFOX_PATH: undefined
  },
  () => {
    const settings: SettingsRecord = {
      ashfox_host: { value: '127.0.0.1' },
      ashfox_port: { value: 9432 },
      ashfox_path: { value: '/mcp-custom' }
    };

    const globals = {
      Setting: createSettingCtor(settings),
      settings
    };
    const config: EndpointConfig = { host: '0.0.0.0', port: 8787, path: '/mcp' };
    let restartCount = 0;

    registerEndpointSettings({
      readGlobals: () => globals,
      config,
      restartServer: () => {
        restartCount += 1;
      }
    });

    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 9432);
    assert.equal(config.path, '/mcp-custom');
    assert.equal(restartCount, 0);
  }
);

{
  const settings: SettingsRecord = {
    ashfox_port: { value: 8787 }
  };
  const globals = {
    Setting: createSettingCtor(settings),
    settings
  };
  const config: EndpointConfig = { host: '127.0.0.1', port: 8787, path: '/mcp' };
  let restartCount = 0;

  registerEndpointSettings({
    readGlobals: () => globals,
    config,
    restartServer: () => {
      restartCount += 1;
    }
  });

  settings.ashfox_port.set?.(9901);
  assert.equal(config.port, 9901);
  assert.equal(settings.ashfox_port.value, 9901);
  assert.equal(restartCount, 1);
}
