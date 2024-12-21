import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, Service } from 'homebridge';

import { LockAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME, SeamConfig } from './settings.js';

import { Seam } from 'seam';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class SeamPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly devices: Map<string, string> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  public _client: Seam | undefined = undefined;

  private timeout: NodeJS.Timeout | undefined = undefined;

  constructor(public readonly log: Logging, public readonly config: SeamConfig, public readonly api: API) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // only load if configured
    if (!config) {
      this.log.warn('Missing config to initialize platform:', this.config.name);
      return;
    }
    if (!this.config.credentials.apiKey) {
      this.log.error('Missing apiKey to initialize platform:', this.config.name);
      return;
    }
    if (!this.config.credentials.workspaceId) {
      this.log.error('Missing workspaceId to initialize platform:', this.config.name);
      return;
    }

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  get client() {
    this._client =
      this._client ||
      new Seam({
        apiKey: this.config.credentials.apiKey,
        workspaceId: this.config.credentials.workspaceId,
      });

    return this._client;
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  async listDevices(deviceIds?: string[]) {
    return await this.client.devices.list({
      device_ids: deviceIds,
    });
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices() {
    if (!this.client) {
      return;
    }

    const devices = await this.listDevices();

    // clear devices map
    this.devices.clear();

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of devices) {
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.device_id);

      // map device id to uuid
      this.devices.set(device.device_id, uuid);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        existingAccessory.context.device = device;
        existingAccessory.context.lastUpdated = new Date();
        existingAccessory.displayName = device.display_name;

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. e.g.:
        // existingAccessory.context.device = device;
        this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new LockAccessory(this, existingAccessory);

        // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, e.g.:
        // remove platform accessories when no longer present
        // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.display_name);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.display_name, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;
        accessory.context.lastUpdated = new Date();
        accessory.displayName = device.display_name;

        switch (device.device_type) {
          case 'akuvox_lock':
          case 'august_lock':
          case 'doorking_lock':
          case 'igloo_lock':
          case 'linear_lock':
          case 'lockly_lock':
          case 'kwikset_lock':
          case 'nuki_lock':
          case 'salto_lock':
          case 'schlage_lock':
          case 'smartthings_lock':
          case 'wyze_lock':
          case 'yale_lock':
          case 'ttlock_lock':
          case 'igloohome_lock':
          case 'hubitat_lock':
          case 'tedee_lock':
          case 'akiles_lock':
            {
              new LockAccessory(this, accessory);
            }
            break;
          case 'brivo_access_point':
          case 'butterflymx_panel':
          case 'avigilon_alta_entry':
          case 'genie_door':
          case 'seam_relay':
          case 'two_n_intercom':
          case 'controlbyweb_device':
          case 'four_suites_door':
          case 'dormakaba_oracode_door': {
            throw new Error('Not implemented yet');
          }
        }

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);

        this.accessories.set(uuid, accessory);
      }

      // push into discoveredCacheUUIDs
      this.discoveredCacheUUIDs.push(uuid);
    }

    // you can also deal with accessories from the cache which are no longer present by removing them from Homebridge
    // for example, if your plugin logs into a cloud account to retrieve a device list, and a user has previously removed a device
    // from this cloud account, then this device will no longer be present in the device list but will still be in the Homebridge cache
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    await this.updateDevices();
  }

  async updateDevices() {
    if (this.timeout) {
      clearInterval(this.timeout);
    }

    const deviceIds = Array.from(this.devices.keys());

    this.log.debug('Updating devices', deviceIds);

    const devices = await this.listDevices(deviceIds);

    for (const device of devices) {
      const uuid = this.devices.get(device.device_id);

      if (!uuid) {
        this.log.error('Device not found', device.device_id);
        continue;
      }

      const existingAccessory = this.accessories.get(uuid);

      if (!existingAccessory) {
        this.log.error('Accessory not found', uuid);
        continue;
      }

      existingAccessory.context.device = device;
      existingAccessory.context.lastUpdated = new Date();

      // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. e.g.:
      // existingAccessory.context.device = device;
      this.api.updatePlatformAccessories([existingAccessory]);
    }

    this.timeout = setInterval(() => {
      setImmediate(() => {
        this.updateDevices();
      });
    }, this.config.refreshRate * 1000);
  }
}
