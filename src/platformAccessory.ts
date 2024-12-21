import type { CharacteristicValue, Logging, PlatformAccessory, Service } from 'homebridge';

import type { SeamPlatform } from './platform.js';
import { Device } from 'seam';
import PQueue from 'p-queue';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LockAccessory {
  private lockService: Service;
  private batteryService: Service;

  private log: Logging;

  private device: Device;
  private lastUpdated: Date;

  private queue: PQueue;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private states: {
    StatusLowBattery: number;
    BatteryLevel: number;
    LockCurrentState: number;
    LockTargetState: number;
    ContactSensorState: number;
  };

  constructor(private readonly platform: SeamPlatform, private readonly accessory: PlatformAccessory) {
    this.log = this.platform.log;
    this.device = this.accessory.context.device;
    this.lastUpdated = new Date();

    this.queue = new PQueue({ concurrency: 1 });

    this.states = {
      StatusLowBattery: this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      BatteryLevel: 100,
      LockCurrentState: this.platform.Characteristic.LockCurrentState.SECURED,
      LockTargetState: this.platform.Characteristic.LockTargetState.SECURED,
      ContactSensorState: this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED,
    };

    // set accessory information
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        this.device.properties.model.manufacturer_display_name || 'Default-Manufacturer',
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        this.device.properties.model.display_name || 'Default-Model',
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        this.device.properties.serial_number || 'Default-Serial',
      );

    this.lockService =
      this.accessory.getService(this.platform.Service.LockMechanism) ||
      this.accessory.addService(this.platform.Service.LockMechanism);

    this.batteryService =
      this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery);

    this.lockService.setCharacteristic(this.platform.Characteristic.Name, this.device.display_name);

    if (this.device.properties.battery) {
      this.batteryService
        .getCharacteristic(this.platform.Characteristic.StatusLowBattery)
        .onGet(this.getStatusLowBattery.bind(this));
      this.batteryService
        .getCharacteristic(this.platform.Characteristic.BatteryLevel)
        .onGet(this.getBatteryLevel.bind(this));
    }

    this.lockService
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(this.getContactSensorState.bind(this));

    this.lockService
      .getCharacteristic(this.platform.Characteristic.LockCurrentState)
      .onGet(this.getLockCurrentState.bind(this));

    this.lockService
      .getCharacteristic(this.platform.Characteristic.LockTargetState)
      .onGet(this.getLockTargetState.bind(this))
      .onSet(this.setLockTargetState.bind(this));

    setInterval(() => {
      if (this.queue.size + this.queue.pending > 0) {
        this.log.debug(this.device.device_id, 'Skipping update (queue is not empty)');
        return;
      }
      if (this.accessory.context.lastUpdated <= this.lastUpdated) {
        return;
      }

      this.log.debug(
        this.device.device_id,
        'Checking for updates',
        this.accessory.context.lastUpdated,
        this.lastUpdated,
      );

      this.device = this.accessory.context.device;
      this.lastUpdated = new Date();

      this.computeAll();
    }, 1000);
  }

  printStateInfo<
    K extends keyof typeof this.states & keyof (typeof this.platform)['Characteristic'],
    V extends (typeof this.states)[K],
  >(state: K, value: V) {
    const from = Object.entries(this.platform.Characteristic[state]).find(([, v]) => v === this.states[state]) || [
      this.states[state],
    ];
    const to = Object.entries(this.platform.Characteristic[state]).find(([, v]) => v === value) || [value];

    this.log.info(this.device.device_id, state, from[0], '->', to[0]);
  }

  updateState<
    K extends keyof typeof this.states & keyof (typeof this.platform)['Characteristic'],
    V extends (typeof this.states)[K],
  >(service: 'lock' | 'battery', state: K, value: V) {
    if (value === this.states[state]) {
      this.log.debug(this.device.device_id, 'Ignoring update', state, this.states[state], '->', value);
      return;
    }

    this.printStateInfo(state, value);

    this.states[state] = value;

    switch (service) {
      case 'lock':
        this.lockService.updateCharacteristic(this.platform.Characteristic[state], value);
        break;
      case 'battery':
        this.batteryService.updateCharacteristic(this.platform.Characteristic[state], value);
        break;
    }
  }

  computeAll() {
    this.log.debug(this.device.device_id, 'Computing all');

    this.updateState('battery', 'StatusLowBattery', this.computeStatusLowBattery());
    this.updateState('battery', 'BatteryLevel', this.computeBatteryLevel());
    this.updateState('lock', 'LockCurrentState', this.computeLockCurrentState());
    this.updateState('lock', 'LockTargetState', this.computeLockCurrentState());
    this.updateState('lock', 'ContactSensorState', this.computeContactSensorState());
  }

  computeStatusLowBattery() {
    switch (this.device.properties.battery?.status) {
      case 'full':
      case 'good':
      default:
        this.log.debug(
          this.device.device_id,
          'Battery status is',
          this.device.properties.battery?.status,
          ', setting StatusLowBattery to BATTERY_LEVEL_NORMAL',
        );
        return this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      case 'low':
      case 'critical':
        this.log.debug(
          this.device.device_id,
          'Battery status is',
          this.device.properties.battery?.status,
          ', setting StatusLowBattery to BATTERY_LEVEL_LOW',
        );
        return this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    }
  }

  getStatusLowBattery() {
    return this.states.StatusLowBattery;
  }

  computeBatteryLevel() {
    const batteryLevel = (this.device.properties.battery?.level ?? 1) * 100;

    this.log.debug(
      this.device.device_id,
      'Battery level is ',
      this.device.properties.battery?.level,
      ', setting BatteryLevel to ',
      batteryLevel,
    );

    return batteryLevel;
  }

  getBatteryLevel() {
    return this.states.BatteryLevel;
  }

  computeLockCurrentState() {
    if (!this.device.properties.online) {
      this.log.warn(this.device.device_id, 'Device is offline, setting LockCurrentState to UNKNOWN');
      return this.platform.Characteristic.LockCurrentState.UNKNOWN;
    }

    switch (this.device.properties.locked) {
      case undefined:
        this.log.warn(this.device.device_id, 'Lock state is unknown, setting LockCurrentState to UNKNOWN');
        return this.platform.Characteristic.LockCurrentState.UNKNOWN;
      case true:
        this.log.debug(this.device.device_id, 'Lock state is locked, setting LockCurrentState to SECURED');
        return this.platform.Characteristic.LockCurrentState.SECURED;
      case false:
        this.log.debug(this.device.device_id, 'Lock state is unlocked, setting LockCurrentState to UNSECURED');
        return this.platform.Characteristic.LockCurrentState.UNSECURED;
    }
  }

  getLockCurrentState() {
    return this.states.LockCurrentState;
  }

  computeContactSensorState() {
    switch (this.device.properties.door_open) {
      case undefined:
      case true:
        this.log.debug(this.device.device_id, 'Door is open, setting ContactSensorState to CONTACT_NOT_DETECTED');
        return this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
      case false:
        this.log.debug(this.device.device_id, 'Door is closed, setting ContactSensorState to CONTACT_DETECTED');
        return this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
    }
  }

  getContactSensorState() {
    return this.states.ContactSensorState;
  }

  getLockTargetState() {
    return this.states.LockTargetState;
  }

  async doLockOrUnlock(action: 'lock' | 'unlock') {
    this.log.info(this.device.device_id, 'Attempt to', action, this.device.device_id);

    await this.platform.client.locks[`${action}Door`]({
      device_id: this.device.device_id,
      sync: true,
    });

    this.log.info(this.device.device_id, 'Complete to', action, this.device.device_id);
  }

  async setLockTargetState(value: CharacteristicValue) {
    if (value === this.states.LockTargetState || value === this.states.LockCurrentState) {
      this.log.debug(this.device.device_id, 'Ignoring setLockTargetState', value, this.states);
      return;
    }

    this.updateState('lock', 'LockTargetState', value as number);

    let promise: Promise<unknown> | null = null;

    switch (value) {
      case this.platform.Characteristic.LockTargetState.SECURED:
        promise = this.doLockOrUnlock('lock');
        break;
      case this.platform.Characteristic.LockTargetState.UNSECURED:
        promise = this.doLockOrUnlock('unlock');
        break;
      default:
        this.log.error(this.device.device_id, 'Unknown LockTargetState', value);
        return;
    }

    this.queue.add(async () => {
      try {
        await promise;

        this.updateState('lock', 'LockCurrentState', value as number);
      } catch (err) {
        this.log.error(this.device.device_id, 'Failed to lock/unlock', err);

        this.updateState('lock', 'LockCurrentState', this.platform.Characteristic.LockCurrentState.UNKNOWN);
      }
    });
  }

  getServices() {
    return [this.lockService];
  }
}
