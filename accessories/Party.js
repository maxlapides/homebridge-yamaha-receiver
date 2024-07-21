let Characteristic, Service;

class Party {
  constructor(avr, platform, config) {
    Service = platform.api.hap.Service;
    Characteristic = platform.api.hap.Characteristic;

    this.log = platform.log;
    this.config = config;
    this.yamaha = avr;
    this.sysConfig = avr.sysConfig;

    this.name = "Party Mode";
    this.nameSuffix = config.name_suffix || " Party Mode";
    this.zone = config.zone || 1;

    this.log(`Adding Party Switch ${this.name}`);
  }

  getServices() {
    const informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.Manufacturer, "yamaha-home")
      .setCharacteristic(Characteristic.Model, this.sysConfig.YAMAHA_AV.System[0].Config[0].Model_Name[0])
      .setCharacteristic(Characteristic.FirmwareRevision, require('../package.json').version)
      .setCharacteristic(Characteristic.SerialNumber, this.sysConfig.YAMAHA_AV.System[0].Config[0].System_ID[0]);

    const partyService = new Service.Switch(this.name);
    partyService.getCharacteristic(Characteristic.On)
      .on('get', this.getPartyModeState.bind(this))
      .on('set', this.setPartyModeState.bind(this));

    return [informationService, partyService];
  }

  getPartyModeState(callback) {
    this.yamaha.isPartyModeEnabled()
      .then(result => callback(null, result))
      .catch(error => callback(error));
  }

  setPartyModeState(on, callback) {
    if (on) {
      this.yamaha.powerOn()
        .then(() => this.yamaha.partyModeOn())
        .then(() => callback(null, true))
        .catch(error => callback(error));
    } else {
      this.yamaha.partyModeOff()
        .then(() => callback(null, false))
        .catch(error => callback(error));
    }
  }
}

module.exports = Party;