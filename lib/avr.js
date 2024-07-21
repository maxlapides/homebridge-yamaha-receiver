const Yamaha = require('yamaha-nodejs');
const Receiver = require('../accessories/Receiver')
const Party = require('../accessories/Party');

module.exports = {
	init: async function() {

		await this.storage.init({
			dir: this.persistPath,
			forgiveParseErrors: true
		})

		this.cachedDevices = await this.storage.getItem('cachedDevices') || []
		this.cachedStates = await this.storage.getItem('cachedStates') || {}

		// remove cachedDevices that were removed from config
		this.cachedDevices = this.cachedDevices.filter(cachedDevice => 
			this.receivers.find(receiver => receiver.ip === cachedDevice.ip))

		for (const config of this.receivers) {

			if (!config.ip)
				continue
				
			// validate ipv4
			const IPV4 = new RegExp(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/)
			if (!IPV4.test(config.ip)) {
				this.log(`"${config.ip}" is not a valid IPv4 address!!`)
				this.log(`skipping "${config.ip}" device...`)
				continue 
			}

			const avr = new Yamaha(config.ip)

			try {
				let systemConfig = await avr.getSystemConfig()
				systemConfig = systemConfig.YAMAHA_AV.System[0].Config[0]
				this.log.easyDebug('Got System Config:')
				this.log.easyDebug(JSON.stringify(systemConfig))
				config.id = systemConfig.System_ID[0]
				config.model = systemConfig.Model_Name[0]
				config.features = systemConfig.Feature_Existence[0]
				config.inputs = systemConfig.Name[0].Input[0]
				this.log(`Found AVR "Yamaha ${config.model}" at ${config.ip}`)
				
			} catch(err) {
				this.log(`Could not detect receiver at ${config.ip}!`)
				this.log(`Control may not work, check your receiver network connection`)
				this.log.easyDebug(err.message)

			}

			// get device from cache if exists
			let deviceConfig = this.cachedDevices.find(device => device.id === config.id || device.ip === config.ip)

			if (deviceConfig) {
				// Update dynamic config params
				deviceConfig.zone1.volume.type = config.volumeAccessory
				deviceConfig.zone1.minVolume = typeof config.minVolume === 'number' ? config.minVolume : -80
				deviceConfig.zone1.maxVolume = typeof config.maxVolume === 'number' ? config.maxVolume : -10
				for (const i of [2,3,4]) {
					if (deviceConfig[`zone${i}`]) {
						deviceConfig[`zone${i}`].active = config[`enableZone${i}`]
						deviceConfig[`zone${i}`].minVolume = typeof config[`zone${i}MinVolume`] === 'number' ? config[`zone${i}MinVolume`] : deviceConfig.zone1.minVolume
						deviceConfig[`zone${i}`].maxVolume = typeof config[`zone${i}MaxVolume`] === 'number' ? config[`zone${i}MaxVolume`] : deviceConfig.zone1.maxVolume
						deviceConfig[`zone${i}`].volume.type = config.volumeAccessory
					}
				}
			} else {
				if (!config.id) {
					this.log(`Can't create new accessory for undetected device (${config.ip}) !`)
					this.log(`skipping "${config.ip}" device...`)
					continue
				}

				// Create config for new device
				try {
					const availableInputs = getInputs(config)
					this.log.easyDebug('Available Inputs:')
					this.log.easyDebug(availableInputs)
					deviceConfig = await createNewConfig(config, avr, availableInputs, this.log)
					this.cachedDevices.push(deviceConfig)
				} catch(err) {
					this.log.easyDebug(err)
					continue
				}
			}
			this.log.easyDebug(`Full Device Config: ${JSON.stringify(deviceConfig)}`)
			// init avr accessories
			newAVR(avr, deviceConfig, this)
		}

		// update cachedDevices storage
		await this.storage.setItem('cachedDevices', this.cachedDevices)

	}
}

const createNewConfig = async (config, avr, availableInputs, log) => {

	try {
		const newConfig = {
			ip: config.ip,
			id: config.id,
			model: config.model,
			zone1: {
				name: config.name,
				inputs: mapInputs(availableInputs),
				minVolume: typeof config.minVolume === 'number' ? config.minVolume : -80,
				maxVolume: typeof config.maxVolume === 'number' ? config.maxVolume : -10,
				volume: {
					name: `${config.name} Volume`,
					type: config.volumeAccessory
				},
			}
		}
		for (const i of [2,3,4]) {
			if (config.features[`Zone_${i}`] && config.features[`Zone_${i}`][0] === '1') {
				log.easyDebug(`Zone ${i} Available!`)
				newConfig[`zone${i}`] = {
					active: config[`enableZone${i}`],
					name: `${config.name} Zone${i}`,
					inputs: mapInputs(availableInputs, true),
					minVolume: typeof config[`zone${i}MaVolume`] === 'number' ? config[`zone${i}MaxVolume`] : -80,
					maxVolume: typeof config[`zone${i}MaxVolume`] === 'number' ? config[`zone${i}MaxVolume`] : -10,
					volume: {
						name: `${config.name} Zone${i} Volume`,
						type: config.volumeAccessory
					}
				}
			}
		}

		return newConfig

	} catch(err) {
		log('ERROR Creating config', err.message)
		throw err
	}
}

const getZoneConfig = (config, zone) => {
	return {
		ip: config.ip,
		id: config.id,
		avrName: config.zone1.name,
		name: config[`zone${zone}`].name,
		zone: zone,
		model: config.model,
		inputs: config[`zone${zone}`].inputs,
		volume: config[`zone${zone}`].volume,
		minVolume: config[`zone${zone}`].minVolume,
		maxVolume: config[`zone${zone}`].maxVolume,
		partySwitchEnabled: true
	}
}

const newAVR = function(avr, deviceConfig, platform) {
	// add main zone
	new Receiver(avr, platform, getZoneConfig(deviceConfig, 1))

	if (true) {
		platform.log.easyDebug(`Party Mode Switch enabled for ${deviceConfig.zone1.name}`);
		new Party(avr, platform, deviceConfig)
	}

	for (const i of [2,3,4]) {
		// add zones
		if (deviceConfig[`zone${i}`] && deviceConfig[`zone${i}`].active) {
			platform.log.easyDebug(`Adding Zone ${i} for ${deviceConfig.zone1.name}`)
			new Receiver(avr, platform, getZoneConfig(deviceConfig, i))
		}
	}
}

const getInputs = function(config) {
	const availableInputs = []

	// iterate through all inputs
	for (const key in config.inputs) {       
		availableInputs.push({
			key: syncKey(key),
			name: config.inputs[key][0]
		})
	}

	// iterate through all features
	for (const key in config.features) {
		const syncedKey = syncKey(key)
		const inputExists = availableInputs.find(input => input.key === syncedKey)
		// Only return inputs that the receiver supports, skip existing, skip Zone entries and USB since it's already in the input list
		if (!inputExists && !key.includes('one') && !key.includes('USB') && config.features[key][0] === '1') {   
			availableInputs.push({
				key: syncedKey,
				name: syncedKey
			})
		}
	}

	return availableInputs
}


const syncKey = function(key) {
	if (key === 'NET_RADIO') 
		return 'NET RADIO'

	if (key === 'MusicCast_Link')
		return 'MusicCast Link'
	
	if (key === 'V_AUX')
		return 'V-AUX';

	if (key === 'Tuner') 
		return 'TUNER';
		
		
	return key.replace('_', '')
  
}

const mapInputs = function(inputs, isZone) {
	let mappedInputs = inputs.map((input, i) => { 
		return {identifier: i, name: input.name, key: input.key, hidden: 0 }
	})

	if (isZone) {
		// add Main Zone Sync input
		mappedInputs.unshift({identifier: mappedInputs.length, name: 'Main Zone Sync', key: 'Main Zone Sync', hidden: 0})
		// remove HDMI inputs
		mappedInputs = mappedInputs.filter(input => !input.key.toLowerCase().includes('hdmi'))
	}

	return mappedInputs
}