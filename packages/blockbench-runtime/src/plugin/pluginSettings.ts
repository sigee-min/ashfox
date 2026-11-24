import type { ReadGlobals, EndpointConfig } from './types';
import { registerEndpointSettings } from './endpointSettings';

export const registerPluginSettings = (deps: {
  readGlobals: ReadGlobals;
  endpointConfig: EndpointConfig;
  restartServer: () => void;
}) => {
  registerEndpointSettings({
    readGlobals: deps.readGlobals,
    config: deps.endpointConfig,
    restartServer: deps.restartServer,
  });
};
