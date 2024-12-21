import { PlatformConfig } from 'homebridge';

/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'SeamPlatform';

/**
 * This must match the name of your plugin as defined the package.json `name` property
 */
export const PLUGIN_NAME = 'homebridge-seam';

export type SeamConfig = PlatformConfig & {
  name: string;
  credentials: {
    apiKey: string;
    workspaceId: string;
  };
  devices: {
    deviceId: string;
    deviceType: 'Lock';
  }[];
  refreshRate: number;
};
