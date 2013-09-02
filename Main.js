/*
TODO:
patrol creeps
buildings that heal shit
*/

// Makes it easier to test stuff
var DEBUG = false;

// Grab libraries
var timers = require('timers');
var upgradeLib = require('upgrades.js');

// Grab upgrade map
var upgradeMap = upgradeLib.upgradeMap;

// Hook set tower level
var setTowerLevel = upgradeLib.setTowerLevel;

// Hook stuff:
console.addClientCommand('builder', CmdBuilder);
console.addClientCommand('build', CmdBuild);
console.addClientCommand('upgrade', CmdUpgrade);
console.addClientCommand('heal', CmdHeal);
console.addClientCommand('shop', CmdShop);
console.addClientCommand('give', CmdGive);
console.addClientCommand('take', CmdTake);
console.addClientCommand('select', CmdSelect);
console.addClientCommand('move', CmdMove);

game.hook('OnMapStart', onMapStart);
game.hook('Dota_OnUnitThink', onUnitThink);
game.hook('Dota_OnUnitParsed', onUnitParsed);
game.hook('Dota_OnHeroPicked', onHeroPicked);
game.hook('Dota_OnBuyItem', onBuyItem);

game.hookEvent("entity_hurt", onEntityHurt);

// To look at gold etc
var playerManager;

// Constants
var UNIT_LIFE_STATE_ALIVE = 0;

// Range Settings
var BUILD_DISTANCE = 250;				// The distance infront of a hero to build
var RUNE_DISTANCE = 200;				// Distance away from a rune spawner a rune spawns
var MAX_BUILDING_FIND_DISTANCE = 500;	// Furthest distance to a tower to be able to find it
var SHOP_RANGE = 500;					// Range for the shop to work
var MOVE_MAX_DISTANCE = 3000;

// Cost Settings
var HEAL_COST = 1;				// The cost for each point of HP healed to a tower
var COST_TOWER = 1000;			// How much a tower costs
var COST_TP_POINT = 200;		// Cost for a teleporter point
var COST_RAX = 1500;			// Cost to purchase a Barracks

var MOVE_COOLDOWN = 3;			// Delay to move building in seconds
var ATTACK_MOVE_COOLDOWN = 5;	// Delay to move a building if it was recently attacked
var BUILD_COOLDOWN = 2;			// Delay between building buildings


// Spawn rate settings
var RAX_SPAWN_RATE = 60000;		// How long inbetween creeps spawning from raxs

// Sounds
SOUND_MOVE_BUILDING = 'ui/inventory/stone_drop_01.wav';
SOUND_LEVEL_BUILDING = 'ui/ui_level_up_01.wav';
SOUND_BUILD = 'ui/npe_objective_complete.wav';

if(DEBUG) {
	// Print warning
	server.print('\n\n\nBUILDER WARNING: DEBUG IS ON!!!\n\n\n');
	
	// custom values for easy testing
	RAX_SPAWN_RATE = 15000;
	COST_TOWER = 1;
	COST_TP_POINT = 1;
	COST_RAX = 1;
	MOVE_COOLDOWN = 3;
	ATTACK_MOVE_COOLDOWN = 2;
	BUILD_COOLDOWN = 3;
}

// List of buildings that need to be made killable
var buildingsArray = new Array();

// List of things to make invisible
var makeInvisArray = upgradeLib.makeInvisArray;

var shopList = new Array();

// Store the ancient entities
var DIRE_ANCIENT;
var RADIANT_ANCIENT;

// Used to spawn custom Units
var customUnit = false;

function onMapStart() {
	// Register all towers into the upgrade system
	var ents = game.findEntitiesByClassname('npc_dota_tower');
	for(var i=0;i<ents.length;++i) {
		setTowerLevel(ents[i], ents[i].netprops.m_iCurrentLevel);
	}
	
	// Remove all buildings
	var b = game.findEntitiesByClassname('npc_dota_building');
	for(var i=0;i<b.length;i++) {
		dota.remove(b[i]);
	}
	
	// Grab the player manager
	playerManager = game.findEntityByClassname(-1, "dota_player_manager");
	
	if(playerManager == null) {
		server.print('\n\nFAILED TO FIND RESOURCE HANDLE\n\n');
	}
	
	// Store ancients
	DIRE_ANCIENT = game.findEntityByTargetname('dota_badguys_fort');
	RADIANT_ANCIENT = game.findEntityByTargetname('dota_goodguys_fort');
}

plugin.get('LobbyManager', function(obj){
	// Default gold per second to 0
	var goldPerSecond = 0;
	
	// Grab options
	var option = obj.getOptionsForPlugin("Builder1")["GoldPerSecond"];
	
	// Ensure we can find the lobby manager
	if(option) {
		// Update gold per second
		goldPerSecond = parseInt(option);
	}
	
	// Check if the players have chosen to use a gold scale
	if(goldPerSecond > 0) {
		// Extra gold taken from EasyMode
		var timer;
		var once = false;
		
		function onGameFrame() {
			var gameTime = game.rules.props.m_fGameTime;
			if (!once && game.rules.props.m_nGameState == dota.STATE_GAME_IN_PROGRESS) {
				once = true;
				timer = game.rules.props.m_fGameTime;
			}
			
			if (gameTime >= timer) {
				timer += 1;
				
				for (var i = 0; i < server.clients.length; ++i) {
					var client = server.clients[i];
					if (!client) continue;
					
					// Grab gold
					var gold = getClientGold(client);
					if(!gold) return;
					
					// Add extra gold
					gold.u += goldPerSecond;
					
					// Store gold
					setClientGold(client, gold);
				}
			}
		}
		
		// Hook it
		game.hook("OnGameFrame", onGameFrame);
	}
});

// Allows players to select buildings
function CmdSelect(client, args) {
	var hero = grabHero(client);
	if(!hero){ return; }
	
	// Grab the nearest building
	var foundBuilding = findBuilding(hero.netprops.m_vecOrigin);
	
	if(foundBuilding) {
		if(foundBuilding.wasBuilt && foundBuilding.netprops.m_iTeamNum == client.netprops.m_iTeamNum) {
			// Select the building
			client.SelectedBuilding = foundBuilding;
			
			client.printToChat('Building selected.');
		} else {
			// This isn't a selectable building
			client.printToChat('You can\'t select buildings not built by your team.');
		}
	} else {
		client.printToChat('You must stand near a building to use this command.');
	}
}

// Allows the client to move buildings
function CmdMove(client, args) {
	var hero = grabHero(client);
	if(!hero){ return; }
	
	// Ensure they have something selected
	if(client.SelectedBuilding && client.SelectedBuilding.isValid()) {
		// Grab current time
		var gametime = game.rules.props.m_fGameTime;
		
		// Cooldown
		if(client.moveCooldown && gametime < client.moveCooldown + MOVE_COOLDOWN) {
			// Workout how long until cooldown is over
			var timeLeft = Math.ceil(client.moveCooldown + MOVE_COOLDOWN - gametime);
			
			// Tell client
			client.printToChat('MOVE COOLDOWN: '+timeLeft+' seconds until active.');
			
			return;
		}
		
		// Check for attack cooldown
		if(client.SelectedBuilding.lastAttacked && gametime < client.SelectedBuilding.lastAttacked + ATTACK_MOVE_COOLDOWN) {
			// Workout how long until cooldown is over
			var timeLeft = Math.ceil((client.SelectedBuilding.lastAttacked + ATTACK_MOVE_COOLDOWN) - gametime);
			
			// Tell client
			client.printToChat('ATTACK COOLDOWN: '+timeLeft+' seconds until active.');
			
			return;
		}
		
		// Grab the clients team
		var team = client.netprops.m_iTeamNum;
		
		// Grab the client's hero position
		var heroAng = hero.netprops.m_angRotation;
		var ang = toRadians(heroAng.y);
		var pos = hero.netprops.m_vecOrigin;
		
		// Grab position
		var x = Math.round(pos.x + BUILD_DISTANCE*Math.cos(ang));
		var y = Math.round(pos.y + BUILD_DISTANCE*Math.sin(ang));
		var z = pos.z;
		
		var vecPos = {
			x: x,
			y: y,
			z: z
		}
		
		var distToAncient;
		if(team == dota.TEAM_RADIANT) {
			distToAncient = vecDist(vecPos, DIRE_ANCIENT.netprops.m_vecOrigin);
		} else if(team == dota.TEAM_DIRE) {
			distToAncient = vecDist(vecPos, RADIANT_ANCIENT.netprops.m_vecOrigin);
		} else {
			client.printToChat('Unknown team.');
			return;
		}
		
		// Enable build protection
		if(distToAncient < 2800) {
			client.printToChat('You are unable to move buildings inside the enemies base.');
			return;
		}
		
		// Enable move distance protection
		var totalDistance = vecDist(vecPos, client.SelectedBuilding.netprops.m_vecOrigin);
		
		if(totalDistance > MOVE_MAX_DISTANCE) {
			client.printToChat('You can\'t move a building that far at once!');
			return;
		}
		
		// Move it into position
		dota.findClearSpaceForUnit(client.SelectedBuilding, x, y, z);
		
		// Add cooldown
		client.moveCooldown = gametime;
		
		// Tell the client
		client.printToChat('The building was moved.');
		
		// Play move sound
		dota.sendAudio(client, false, SOUND_MOVE_BUILDING);
	} else {
		client.printToChat('Stand near a building and -select it first.');
	}
}

// Allows players to take items out of their inventory and place them inside buildings
function CmdGive(client, args) {
	var hero = grabHero(client);
	if(!hero){ return; }
	
	// Tell the client how to use it
	if(args.length != 1) {
		client.printToChat('Usage: -give [slotnumber] (1 - 6)');
		client.printToChat('Stand near a building and it will give [slotnumber] item to it from your inventory.');
		client.printToChat('EG: -give 1');
		return;
	}
	
	// Workout which slot they asked for
	var slot = Number(args[0]);
	
	// Ensure it's a valid slot
	if(isNaN(slot) || slot < 1 || slot > 6) {
		client.printToChat('Valid slots are 1 - 6.');
		return;
	}
	
	// Make slot match game
	slot -= 1;
	
	// Ensure there is something in said slot
	var oldItem = hero.netprops.m_hItems[slot]
	
	if(!oldItem) {
		client.printToChat('There isn\'t anything in this slot.');
		return;
	}
	
	// Grab the nearest building
	var foundBuilding = findBuilding(hero.netprops.m_vecOrigin);
	
	if(foundBuilding) {
		// Check if they are not on the same team
		if(foundBuilding.netprops.m_iTeamNum != client.netprops.m_iTeamNum) {
			client.printToChat('This is an enemy building.');
			return;
		}
		
		// This building has no space by default
		var space = -1;
		
		for(var i=0; i<6; ++i) {
			// Grab the item in each slot
			var item = foundBuilding.netprops.m_hItems[i];
			
			// Check if it's one of our tower items
			if(!item) {
				// This slot is free
				space = i;
				break;
			}
		}
		
		// Check if we found a space
		if(space != -1) {
			// Give the new item
			var newItem = dota.giveItemToHero(oldItem.getClassname(), foundBuilding);
			
			// Copy over item stats
			copyAtts(newItem, oldItem);
			
			// Delete the old item
			dota.remove(oldItem);
			hero.netprops.m_hItems[slot] = null;
		} else {
			client.printToChat('This building has no space left.');
		}
	} else {
		client.printToChat('You aren\'t near any buildings.');
	}
}

// Allows players to take items buildings inventories
function CmdTake(client, args) {
	var hero = grabHero(client);
	if(!hero){ return; }
	
	// Tell the client how to use it
	if(args.length != 1) {
		client.printToChat('Usage: -take [slotnumber] (1 - 6)');
		client.printToChat('Stand near a building and it will take [slotnumber] item from it\'s inventory.');
		client.printToChat('EG: -take 1');
		return;
	}
	
	// Workout which slot they asked for
	var slot = Number(args[0]);
	
	// Ensure it's a valid slot
	if(isNaN(slot) || slot < 1 || slot > 6) {
		client.printToChat('Valid slots are 1 - 6.');
		return;
	}
	
	// Make slot match game
	slot -= 1;
	
	var space = -1;
	
	// Ensure they have space
	for(var i=0; i<6; ++i) {
		// Grab the item in each slot
		var item = hero.netprops.m_hItems[i];
		
		// Check if it's one of our tower items
		if(!item) {
			// This slot is free
			space = i;
			break;
		}
	}
	
	if(space == -1) {
		client.printToChat('You don\'t have any space to take any items.');
		return;
	}
	
	// Grab the nearest building
	var foundBuilding = findBuilding(hero.netprops.m_vecOrigin);
	
	if(foundBuilding) {
		// Check if they are not on the same team
		if(foundBuilding.netprops.m_iTeamNum != client.netprops.m_iTeamNum) {
			client.printToChat('This is an enemy building.');
			return;
		}
		
		// Ensure they have an item to take
		var oldItem = foundBuilding.netprops.m_hItems[slot];
		
		if(!oldItem) {
			client.printToChat('There is no item in this slot to take.');
			return
		}
		
		// Give the new item
		var newItem = dota.giveItemToHero(oldItem.getClassname(), hero);
		
		// Copy over item stats
		copyAtts(newItem, oldItem);
		
		// Delete the old item
		dota.remove(oldItem);
		foundBuilding.netprops.m_hItems[slot] = null;
		
		// Tell the player 
		client.printToChat('If you can\'t use the item, try dropping it and picking it back up.');
	} else {
		client.printToChat('You aren\'t near any buildings.');
	}
}

// Allow clients to upgrade buildings
function CmdUpgrade(client, args) {
	var hero = grabHero(client);
	if(!hero){ return; }
	
	// Grab the nearest building
	var foundBuilding = findBuilding(hero.netprops.m_vecOrigin);
	
	// Check if we found a tower
	if(foundBuilding) {
		var ent = foundBuilding;
		
		// Check if they are not on the same team
		if(ent.netprops.m_iTeamNum != client.netprops.m_iTeamNum) {
			client.printToChat('This is an enemy building.');
			return;
		}
		
		// Grab the upgrades for this ent
		var upgrades;
		if(ent.specialSort) {
			upgrades = upgradeMap[ent.getClassname()+'_'+ent.specialSort];
		} else {
			upgrades = upgradeMap[ent.getClassname()];
		}
		
		// Check if an upgrade exists 
		if(upgrades) {
			// Ensure it has a nobuy
			if(!ent.NoBuy) {
				ent.NoBuy = {};
			}
			
			if(args.length == 1) {
				// Grab the upgrade name
				var upgradeName = args[0].toLowerCase();
				
				// Check if this is a valid upgrade
				for(var i=0;i<upgrades.length;i++) {
					if(upgrades[i].name == upgradeName) {
						// Check if this upgrade has already been purchased
						if(ent.NoBuy[upgradeName] != null) {
							// Check for max level
							if(upgrades[i].max && upgrades[i].max == ent.NoBuy[upgradeName]) {
								client.printToChat('This upgrade is at it\'s max level.');
								return;
							}
						}
						
						// Check for uniqueness
						if(upgrades[i].unique) {
							if(ent.uniqueUpgrade && ent.uniqueUpgrade[upgrades[i].unique] && ent.uniqueUpgrade[upgrades[i].unique] == upgradeName) {
								client.printToChat('This upgrade is already active.');
								return;
							}
						}
						
						// Take gold
						if(cantAfford(client, upgrades[i].cost)){
							client.printToChat('You don\'t have enough gold to purchase this upgrade. ('+upgrades[i].cost+')');
							return;
						}
						
						// Grab current level
						var currentLevel = 0;
						if(ent.NoBuy[upgradeName]) {
							currentLevel = ent.NoBuy[upgradeName];
						}
						
						// Give the upgrade
						upgrades[i].effect(ent, upgradeName, client, currentLevel);
						
						// Store the pass
						ent.CampPass = upgrades[i].pass;
						
						// Add to the total number purchased
						if(!ent.NoBuy[upgradeName]) {
							ent.NoBuy[upgradeName] = 1;
						} else {
							ent.NoBuy[upgradeName] += 1;
						}
						
						// Store uniqueness
						if(upgrades[i].unique) {
							// Ensure we have all the storages nessessary
							if(!ent.uniqueUpgrade) {
								ent.uniqueUpgrade = {};
							}
							
							// Store the current upgrade as active
							ent.uniqueUpgrade[upgrades[i].unique] = upgradeName;
						}
						
						// Tell the client
						client.printToChat('Upgrade \''+upgradeName+'\' has been purchased.');
						
						// Play upgrade sound
						dota.sendAudio(client, false, SOUND_LEVEL_BUILDING);
						
						return;
					}
				}
			}
			
			// Tell the client which upgrades are available
			client.printToChat('The following upgrade are available:');
			for(var i=0;i<upgrades.length;i++) {
				// Check if the building already has this upgrade
				if(upgrades[i].max) {
					var upgradeName = upgrades[i].name.toLowerCase();
					var currentLevel = 0;
					
					// Check if that building has that upgrade
					if(ent.NoBuy && ent.NoBuy[upgradeName]) {
						currentLevel = ent.NoBuy[upgradeName];
					}
					
					client.printToChat('['+currentLevel+'/'+upgrades[i].max+'] '+upgrades[i].name +' [' +upgrades[i].cost +'g] - ' +upgrades[i].desc);
				} else {
					// Check for unique groups
					if(upgrades[i].unique) {
						client.printToChat(upgrades[i].name +' [' +upgrades[i].cost +'g] - ' +upgrades[i].desc);
					}
				}
			}
			
			// Check for unqiue upgrades
			if(ent.uniqueUpgrade) {
				for(var key in ent.uniqueUpgrade) {
					client.printToChat(key+': '+ent.uniqueUpgrade[key]);
				}
			}
		} else {
			// No upgrades exist
			client.printToChat('There are no upgrades for this building.');
		}
	} else {
		client.printToChat('You are not near any buildings.');
	}
}

// Allow clients to enter a shop
function CmdShop(client, args) {
	var hero = grabHero(client);
	if(!hero){ return; }
	
	// Check for a makeshift shop
	if(!ShopCheck(hero)) {
		client.printToChat('You are not near any tps with a shop upgrade.');
	}
}

function CmdHeal(client, args) {
	var hero = grabHero(client);
	if(!hero){ return; }
	
	var pointsMissing = 0;
	var healCost = 0;
	
	// Grab the nearest building
	var foundBuilding = findBuilding(hero.netprops.m_vecOrigin);
	
	if(foundBuilding) {
		// Check if they are not on the same team
		if(foundBuilding.netprops.m_iTeamNum != client.netprops.m_iTeamNum) {
			client.printToChat('This is an enemy building.');
			return;
		}
		
		// Workout useful stuff
		pointsMissing = foundBuilding.netprops.m_iMaxHealth - foundBuilding.netprops.m_iHealth;
		healCost = pointsMissing * HEAL_COST;
	}
	
	// Show usage
	if(args.length != 1) {
		// Tell how to use the plugin
		client.printToChat('Commands to use when near a building:');
		client.printToChat('Heal Costs: -heal');
		client.printToChat('Partial Heal: -heal [amount]');
		client.printToChat('Full Heal: -heal max');
		
		// Check if we found a building
		if(foundBuilding) {
			// Check if any HP is missing
			if(pointsMissing > 0) {
				// Tell how much HP is missing and cost
				client.printToChat('This building is missing '+pointsMissing+' HP which will cost '+healCost+' to fully heal.');
			} else {
				// Tell that the building is fully healed
				client.printToChat('This building is already fully healed.');
			}
		} else {
			// Tell the healing costs
			client.printToChat('Healing costs '+HEAL_COST+' gold for each point of health healed.');
		}

		return;
	}
	
	if(foundBuilding) {
		// Check if any HP is missing
		if(pointsMissing <= 0) {
			client.printToChat('This building is already fully healed.');
			return;
		}
		
		// Grab player ID
		var playerID = client.netprops.m_iPlayerID;
		if (playerID == -1) {
			return false;
		}
		
		// Workout how much they want to heal this building
		var requestHeal = args[0];
		
		if(requestHeal == 'full' || requestHeal == 'max') {
			requestHeal = pointsMissing;
		} else {
			// Convert to a number
			requestHeal = Number(requestHeal);
		}
		
		// Validate the points
		if(isNaN(requestHeal) || requestHeal <= 0) {
			client.printToChat('You can not heal less than one HP.');
			return;
		}
		
		// Grab how much gold the player has
		var gold = getClientGold(client);
		if(gold == null) {
			return true;
		}
		
		// Workout the max this client can heal the building
		var healAfford = Math.floor((gold.r + gold.u)/HEAL_COST);
		var maxHeal = Math.min(healAfford, requestHeal, pointsMissing);
		var cost = maxHeal * HEAL_COST
		
		// Check if the player can even afford to heal a single HP
		if(maxHeal <= 0) {
			client.printToChat('You can\'t afford to heal this building.');
			return;
		}
		
		// Calculate new gold values
		gold.u -= cost;
		if(gold.u < 0) {
			gold.r += gold.u;
			gold.u = 0;
		}
		
		// Store new gold values
		if(setClientGold(client, gold)) {
			// Heal building
			foundBuilding.netprops.m_iHealth += maxHeal;
			
			// Tell the user
			client.printToChat('You healed '+maxHeal+' HP for '+cost+' gold.');
		} else {
			// _something_ went wrong, no idea what
			client.printToChat('Something went wrong, please tell Ash47');
		}
	} else {
		// The player isn't near a building
		client.printToChat('You are not near a building.');
	}
}

function CmdBuild(client, args) {
	// Check if they've used it correctly
	if(args.length != 1) {
		printBuildUsage(client);
		return;
	}
	
	// Cooldown
	var gametime = game.rules.props.m_fGameTime;
	if(client.buildCooldown && gametime < client.buildCooldown + BUILD_COOLDOWN) {
		// Workout how long until cooldown is over
		var timeLeft = Math.ceil((client.buildCooldown + BUILD_COOLDOWN) - gametime);
		
		// Tell client
		client.printToChat('BUILD COOLDOWN: '+timeLeft+' seconds until active.');
		
		return;
	}
	
	var hero = grabHero(client);
	if(!hero){ return; }
	
	// Grab the clients team
	var team = client.netprops.m_iTeamNum;
	
	// Grab the client's hero position
	var pos = hero.netprops.m_vecOrigin;
	var heroAng = hero.netprops.m_angRotation;
	var ang = toRadians(heroAng.y);
	
	// Grab position
	var x = Math.round(pos.x + BUILD_DISTANCE*Math.cos(ang));
	var y = Math.round(pos.y + BUILD_DISTANCE*Math.sin(ang));
	var z = pos.z;
	
	var vecPos = {
		x: x,
		y: y,
		z: z
	}
	
	var distToAncient;
	if(team == dota.TEAM_RADIANT) {
		distToAncient = vecDist(vecPos, DIRE_ANCIENT.netprops.m_vecOrigin);
	} else if(team == dota.TEAM_DIRE) {
		distToAncient = vecDist(vecPos, RADIANT_ANCIENT.netprops.m_vecOrigin);
	} else {
		client.printToChat('Unknown team.');
		return;
	}
	
	// Enable build protection
	if(distToAncient < 2800) {
		client.printToChat('You are unable to build in the enemies base!');
		return;
	}
	
	switch(args[0].toLowerCase()) {
	case 'list':
		printBuildList(client);
	break;
	
	case 'tp':
		// Take gold
		if(cantAfford(client, COST_TP_POINT)){
			client.printToChat('You don\'t have enough gold for a teleporter point ('+COST_TP_POINT+')');
			return;
		}
		
		// Enable Custom unit spawning
		customUnit = {};
		customUnit.keys = {
			Ability1: ''
		};
		
		var ent;
		
		if(team == dota.TEAM_RADIANT) {
			// Create a radiant building
			customUnit.keys.model = 'models/props_structures/good_statue008.mdl';
			ent = dota.createUnit('dota_goodguys_fillers', team);
			
			// Set key values
			ent.keyvalues.destroysound = 'Building_RadiantTower.Destruction';
			ent.keyvalues.destroyfx = 'good_statue008_destroy';
			ent.keyvalues.destdmgamnt_lvl2 = '33';
			ent.keyvalues.destdmgamnt_lvl1 = '66';
		} else if(team == dota.TEAM_DIRE) {
			// Create a dire building
			customUnit.keys.model = 'models/props_structures/bad_statue001.mdl';
			ent = dota.createUnit('dota_badguys_fillers', team);
			
			// Set key values
			ent.keyvalues.destroysound = 'Building_DireTower.Destruction';
			ent.keyvalues.destroyfx = 'statue001_bad_destroy';
			ent.keyvalues.destdmgamnt_lvl2 = '33';
			ent.keyvalues.destdmgamnt_lvl1 = '66';
		} else {
			client.printToChat('Unknown team.');
			return;
		}
		
		// Disable custom units
		customUnit = false;
		
		// Move it into position
		dota.findClearSpaceForUnit(ent, x, y, z);
		
		// Make it killable
		buildingsArray.push(ent);
		
		// Set it's health, it should be DENYABLE
		ent.netprops.m_iMaxHealth = 100;
		ent.netprops.m_iHealth = 100;
		
		// Store on the ent that it is a teleporter
		ent.specialSort = 'teleporter';
		
		// This was built
		ent.wasBuilt = true;
		
		// Store cooldown;
		client.buildCooldown = gametime;
		
		// Play build sound
		dota.sendAudio(client, false, SOUND_BUILD);
	break;
	
	case 'rax':
		// Take gold
		if(cantAfford(client, COST_RAX)){
			client.printToChat('You don\'t have enough gold for a Barracks. ('+COST_RAX+')');
			return;
		}
		
		// Enable Custom unit spawning
		customUnit = {};
		customUnit.keys = {
			Ability1: ''
		};
		
		var ent;
		
		if(team == dota.TEAM_RADIANT) {
			// Create a radiant building
			customUnit.keys.model = 'models/props_structures/good_statue010.mdl';
			ent = dota.createUnit('dota_goodguys_fillers', team);
			
			// Set key values
			ent.keyvalues.destroysound = 'Building_RadiantTower.Destruction';
			ent.keyvalues.destroyfx = 'good_statue010_destroy';
			ent.keyvalues.destdmgamnt_lvl2 = '33';
			ent.keyvalues.destdmgamnt_lvl1 = '66';
		} else if(team == dota.TEAM_DIRE) {
			// Create a dire building
			customUnit.keys.model = 'models/props_structures/bad_statue002.mdl';
			ent = dota.createUnit('dota_badguys_fillers', team);
			
			// Set key values
			ent.keyvalues.destroysound = 'Building_DireTower.Destruction';
			ent.keyvalues.destroyfx = 'statue002_bad_destroy';
			ent.keyvalues.destdmgamnt_lvl2 = '33';
			ent.keyvalues.destdmgamnt_lvl1 = '66';
		} else {
			client.printToChat('Unknown team.');
			return;
		}
		
		// Disable custom units
		customUnit = false;
		
		// Move it into position
		dota.findClearSpaceForUnit(ent, x, y, z);
		
		// Make it killable
		buildingsArray.push(ent);
		
		// Set it's health
		ent.netprops.m_iMaxHealth = 1000;
		ent.netprops.m_iHealth = 1000;
		
		// Store on the ent that it is a spawned rax
		ent.specialSort = 'rax';
		
		// Default settings for a rax
		ent.CampSpawnBad = new Array(
			'npc_dota_creep_badguys_melee',
			'npc_dota_creep_badguys_melee',
			'npc_dota_creep_badguys_melee'
		);
		
		ent.CampSpawnGood = new Array(
			'npc_dota_creep_goodguys_melee',
			'npc_dota_creep_goodguys_melee',
			'npc_dota_creep_goodguys_melee'
		);
		
		// Set the active upgrade to melee
		ent.uniqueUpgrade = {};
		ent.uniqueUpgrade['Active Creep'] = 'melee';
		
		// This was built
		ent.wasBuilt = true;
		
		// Store cooldown;
		client.buildCooldown = gametime;
		
		// Play build sound
		dota.sendAudio(client, false, SOUND_BUILD);
		
		
		var timer;
		
		// Create spawn loop
		timer = timers.setInterval(function() {
			if(ent && ent.wasBuilt && ent.isValid()) {
				var pos = ent.netprops.m_vecOrigin;
				
				// This command has to be different based on the team of the client
				if(team == dota.TEAM_RADIANT) {
					// Create Creeps
					for(var i=0;i<ent.CampSpawnGood.length;i++) {
						// Spawn creeps
						var creep = dota.createUnit(ent.CampSpawnGood[i], team);
						
						// Teleport
						dota.findClearSpaceForUnit(creep, pos);
						
						// March
						dota.setUnitWaypoint(creep, DIRE_ANCIENT);
						
						// Apply custom netprops
						if(ent.CustomNetprops) {
							for(var j in ent.CustomNetprops) {
								creep.netprops[j] = ent.CustomNetprops[j];
							}
						}
						
						// Do post process on creep
						if(ent.CampPass) {
							ent.CampPass(creep);
						}
					}
				} else {
					// Create Creeps
					for(var i=0;i<ent.CampSpawnBad.length;i++) {
						// Spawn creeps
						var creep = dota.createUnit(ent.CampSpawnBad[i], team);
						
						// Teleport
						dota.findClearSpaceForUnit(creep, pos);
						
						// March
						dota.setUnitWaypoint(creep, RADIANT_ANCIENT);
						
						// Apply custom netprops
						if(ent.CustomNetprops) {
							for(var j in ent.CustomNetprops) {
								creep.netprops[j] = ent.CustomNetprops[j];
							}
						}
						
						// Do post process on creep
						if(ent.CampPass) {
							ent.CampPass(creep);
						}
					}
				}
			} else {
				// Stop this timer
				timers.clearTimer(timer);
			}
		}, RAX_SPAWN_RATE);
		
		// Store timer onto ent
		ent.timer = timer;
	break;
	
	case 'tower':
		// Take gold
		if(cantAfford(client, COST_TOWER)){
			client.printToChat('You don\'t have enough gold for a tower ('+COST_TOWER+')');
			return;
		}
		
		// Enable Custom unit spawning
		customUnit = {};
		customUnit.keys = {};
		
		var ent;
		
		if(team == dota.TEAM_RADIANT) {
			// Create a radiant tower
			customUnit.keys.model = 'models/props_structures/tower_good.mdl';
			ent = dota.createUnit('dota_goodguys_tower1_top', team);
			
			// Set key values
			ent.keyvalues.destruction_lvl2 = 'models/props_structures/tower_good3_dest_lvl2.mdl';
			ent.keyvalues.destruction_lvl1 = 'models/props_structures/tower_good3_dest_lvl1.mdl';
			ent.keyvalues.destroysound = 'Building_RadiantTower.Destruction';
			ent.keyvalues.destroyfx = 'tower_good3_destroy_lvl3';
			ent.keyvalues.destdmgamnt_lvl2 = '33';
			ent.keyvalues.destdmgamnt_lvl1 = '66';
		} else if(team == dota.TEAM_DIRE) {
			// Create a dire tower
			customUnit.keys.model = 'models/props_structures/tower_bad.mdl';
			ent = dota.createUnit('dota_badguys_tower1_top', team);
			
			// Set key values
			ent.keyvalues.destruction_lvl2 = 'models/props_structures/bad_tower_destruction_lev2.mdl';
			ent.keyvalues.destruction_lvl1 = 'models/props_structures/bad_tower_destruction_lev1.mdl';
			ent.keyvalues.destroysound = 'Building_DireTower.Destruction';
			ent.keyvalues.destroyfx = 'tower_bad_destroy';
			ent.keyvalues.destdmgamnt_lvl2 = '33';
			ent.keyvalues.destdmgamnt_lvl1 = '66';
		} else {
			client.printToChat('Unknown team.');
			return;
		}
		
		// Reset custom unit
		customUnit = false;
		
		// Move it into position
		dota.findClearSpaceForUnit(ent, x, y, z);
		
		// Make it killable
		buildingsArray.push(ent);
		
		// Set the tower's level
		setTowerLevel(ent, 1);
		
		// This was built
		ent.wasBuilt = true;
		
		// Store cooldown;
		client.buildCooldown = gametime;
		
		// Play build sound
		dota.sendAudio(client, false, SOUND_BUILD);
	break;
	
	default:
		// Unknown building
		printBuildUsage(client);
	break;
	}
}

// Change models of buildings
function onUnitParsed(ent, keys) {
	// Check if there is a custom unit
	if(customUnit) {
		// Copy in custom keys
		if(customUnit.keys) {
			for(var k in customUnit.keys) {
				keys[k] = customUnit.keys[k];
			}
		}
	}
}

// Apply skills to buildings
function onUnitThink(ent) {
	// Destroyable
	if(buildingsArray.indexOf(ent) != -1) {
		// Hopefully a temp fix to make buildings destroyable
		dota.setUnitState(ent, dota.UNIT_STATE_INVULNERABLE , false);
		dota.setUnitState(ent, dota.UNIT_STATE_NO_HEALTHBAR  , false);
	}
	
	// Invisible
	if(makeInvisArray.indexOf(ent) != -1) {
		dota.setUnitState(ent, dota.UNIT_STATE_INVISIBLE  , true);
	}
}

function onEntityHurt(event) {
	// Grab the entity that was attacked
	var ent = game.getEntityByIndex(event.getInt('entindex_killed'));
	var attacker = game.getEntityByIndex(event.getInt('entindex_attacker'));
	
	// Ensure it was built
	if(ent.wasBuilt) {
		// Store when they were last attacked
		ent.lastAttacked = game.rules.props.m_fGameTime;
	}
	
	// Implement life steal
	if(attacker && attacker.lifestealBonus) {
		// Calculate amount to steal
		var damage = attacker.netprops.m_iDamageMin + attacker.netprops.m_iDamageBonus;
		var lifesteal = Math.ceil(damage * attacker.lifestealBonus / 100);
		
		// Workout max HP
		var maxHP = attacker.netprops.m_iMaxHealth;
		
		// Increase health
		attacker.netprops.m_iHealth += lifesteal;
		
		// Cap health
		if(attacker.netprops.m_iHealth > maxHP) {
			attacker.netprops.m_iHealth = maxHP;
		}
		
		/*var index = dota.createParticleEffect(ent, "kunkka_torrent_splash", 1);
		var pos = ent.netprops.m_vecOrigin;
		
		// Push effect to all clients
		var clients = getConnectedPlayingClients();
		for (i=0; i<clients.length; i++) {
			var client = clients[i];
			
			dota.setParticleControl(client, index, 0, pos);
		}*/
	}
	
	// Implement mana burn
	if(attacker && attacker.manaburnBonus) {
		// Check if the unit has any mana
		ent.netprops.m_flMana -= attacker.manaburnBonus;
		
		// Make sure it doesn't go below 0
		if(ent.netprops.m_flMana < 0) {
			ent.netprops.m_flMana = 0;
		}
	}
	
	// Abaddon's ult
	if(ent && ent.borrowedtimeModder) {
		if(ent.netprops.m_iHealth <= 400) {
			var gametime = game.rules.props.m_fGameTime;
			
			// Check when we last used it
			if(!ent.borrowedtimeModder.lastUsed || gametime > ent.borrowedtimeModder.lastUsed + ent.borrowedtimeModder.cooldown) {
				// Store when we last used it
				ent.borrowedtimeModder.lastUsed = gametime;
				
				// Activate it
				dota.addNewModifier(ent, ent.borrowedtimeModder, 'modifier_abaddon_borrowed_time', "abaddon_borrowed_time", {duration:ent.borrowedtimeModder.duration});
				
				// Store cooldown
				ent.borrowedtimeModder.netprops.m_flCooldownLength = ent.borrowedtimeModder.cooldown;
				ent.borrowedtimeModder.netprops.m_fCooldown = gametime + ent.borrowedtimeModder.cooldown;
			}
		}
	}
	
	// Stop spawning shit ffs
	if(ent.getClassname() == 'npc_dota_building') {
		// Check health
		if(ent.netprops.m_iHealth <= 0) {
			// Check for a timer
			if(ent.timer) {
				// Remove the timer
				timers.clearTimer(ent.timer);
				ent.timer = null;
			}
			
			// Check for a timer2
			if(ent.timer2) {
				// Remove the timer
				timers.clearTimer(ent.timer2);
				ent.timer2 = null;
			}
		}
	}
}

// Copy item atrributes from one item into another
function copyAtts(newItem, oldItem) {
	newItem.netprops.m_bCombinable = oldItem.netprops.m_bCombinable;
	newItem.netprops.m_bPermanent = oldItem.netprops.m_bPermanent;
	newItem.netprops.m_bStackable = oldItem.netprops.m_bStackable;
	newItem.netprops.m_bRecipe = oldItem.netprops.m_bRecipe;
	newItem.netprops.m_bDroppable = oldItem.netprops.m_bDroppable;
	newItem.netprops.m_bPurchasable = oldItem.netprops.m_bPurchasable;
	newItem.netprops.m_bSellable = oldItem.netprops.m_bSellable;
	newItem.netprops.m_bRequiresCharges = oldItem.netprops.m_bRequiresCharges;
	newItem.netprops.m_bKillable = oldItem.netprops.m_bKillable;
	newItem.netprops.m_bDisassemblable = oldItem.netprops.m_bDisassemblable;
	newItem.netprops.m_bAlertable = oldItem.netprops.m_bAlertable;
	newItem.netprops.m_iCurrentCharges = oldItem.netprops.m_iCurrentCharges;
	newItem.netprops.m_flPurchaseTime = oldItem.netprops.m_flPurchaseTime;
	newItem.netprops.m_iInitialCharges = oldItem.netprops.m_iInitialCharges;
	newItem.netprops.m_hPurchaser = oldItem.netprops.m_hPurchaser;
}

// Convert degrees to radians
function toRadians (angle) {
	return angle * (Math.PI / 180);
}

// Do adverts
function onHeroPicked(client, clsname) {
	// Ensure this only get's printed the 2nd time:
	if(client.printedHelp) {
		client.printedHelp += 1;
	} else {
		client.printedHelp = 1;
	}
	
	if(client.printedHelp == 2) {
		// Tell the client how to find help
		client.printToChat('BUILDER: Type -builder for a list of commands.');
	}
}

function onBuyItem(ent, itemName, playerID, unknown) {
	// Check for a makeshift shop
	ShopCheck(ent);
	
	// Allow them to buy the item
	return true;
}

// Checks if a player is hero is near a makeshift shop, and enables shop on them
function ShopCheck(ent) {
	var oldShop = ent.netprops.m_iCurShop;
	
	if(oldShop == 6) {
		// Grab their position
		var pos = ent.netprops.m_vecOrigin;
		
		for(var i=0;i<shopList.length;++i) {
			// Check if it's a shop
			if(shopList[i]) {
				// Workout distance to this tower
				var dist = vecDist(pos, shopList[i].netprops.m_vecOrigin);
				
				// Check if the distance is less then the threshold
				if(dist < SHOP_RANGE) {
					// Ensure they are in a shop
					ent.netprops.m_iCurShop = 0;
					
					var timer;
					var shopEnt = shopList[i];
					
					// Pull them out of the shop straight away
					timer = timers.setInterval(function() {
						// Ensure our ent still exists
						if(!ent) {
							timers.clearTimer(timer);
							return;
						}
						
						// Check if they moved out of range of the shop
						var dist = vecDist(ent.netprops.m_vecOrigin, shopEnt.netprops.m_vecOrigin);
						
						if(dist > SHOP_RANGE) {
							// Set their shop back
							ent.netprops.m_iCurShop = oldShop;
							
							// Remove this timer
							timers.clearTimer(timer);
						}
					}, 1000);
					
					return true;
				}
			}
		}
	}
	
	// They aren't near any shops
	return false;
}

// Calculates the distance between two vectors (not taking into account for z)
function vecDist(vec1, vec2) {
	var xx = (vec1.x - vec2.x);
	var yy = (vec1.y - vec2.y);
	
	return Math.sqrt(xx*xx + yy*yy);
}

function findBuilding(pos) {
	// Grab all the towers
	var ents = game.findEntitiesByClassname('npc_dota_tower');
	
	// Grab all buildings
	ents = ents.concat(game.findEntitiesByClassname('npc_dota_building'));
	
	// Grab the barracks
	ents = ents.concat(game.findEntitiesByClassname('npc_dota_barracks'));
	
	// Grab the ancients
	ents = ents.concat(game.findEntitiesByClassname('npc_dota_fort'));
	
	var findDist = MAX_BUILDING_FIND_DISTANCE;
	var foundBuilding = null;
	
	for(var i=0;i<ents.length;++i) {
		// Workout distance to this tower
		var dist = vecDist(pos, ents[i].netprops.m_vecOrigin);
		
		// Check if the distance is less then the threshold
		if(dist < findDist) {
			// Update distance, store new ent
			findDist = dist;
			foundBuilding = ents[i];
		}
	}
	
	return foundBuilding;
}

// Grabs a hero or return false if the client doesn't have one
function grabHero(client) {
	var hero = client.netprops.m_hAssignedHero;
	
	// Check if the player is ingame:
	if(!hero) {
		// Tell the user they can't build yet:
		client.printToChat('You can\'t use this until you are ingame.');
		return null;
	}
	
	if (!hero.isHero()) return null;
	
	// Ensure they are alive
	if(hero.netprops.m_lifeState != UNIT_LIFE_STATE_ALIVE) {
		client.printToChat('You must be alive to use this command.');
		return null;
	}
	
	return hero;
}

// Gets the client gold
function getClientGold(client) {
	// Grab playerID
	var playerID = client.netprops.m_iPlayerID;
	if (playerID == -1) {
		return null;
	}
	
	// Grab the clients team
	var team = client.netprops.m_iTeamNum;
	
	// Declare variables (yes, you are reading redundent comments)
	var reliableGold;
	var unreliableGold;
	
	// Read their gold, where we read depends on their team
	if(team == dota.TEAM_RADIANT) {
		reliableGold = playerManager.netprops.m_iReliableGoldRadiant[playerID];
		unreliableGold = playerManager.netprops.m_iUnreliableGoldRadiant[playerID];
	} else if(team == dota.TEAM_DIRE) {
		reliableGold = playerManager.netprops.m_iReliableGoldDire[playerID];
		unreliableGold = playerManager.netprops.m_iUnreliableGoldDire[playerID];
	} else {
		return null;
	}
	
	// Return table with money data
	return {
		r:reliableGold,
		u:unreliableGold
	}
}

// Sets the clients gold
function setClientGold(client, gold) {
	// Validate gold
	if(gold == null || gold.r == null || gold.u == null) {
		return false;
	}
	
	// Grab playerID
	var playerID = client.netprops.m_iPlayerID;
	if (playerID == -1) {
		return false;
	}
	
	// Grab the clients team
	var team = client.netprops.m_iTeamNum;
	
	// Set their gold, depending on their team
	if(team == dota.TEAM_RADIANT) {
		playerManager.netprops.m_iReliableGoldRadiant[playerID] = gold.r;
		playerManager.netprops.m_iUnreliableGoldRadiant[playerID] = gold.u;
	} else if(team == dota.TEAM_DIRE) {
		playerManager.netprops.m_iReliableGoldDire[playerID] = gold.r;
		playerManager.netprops.m_iUnreliableGoldDire[playerID] = gold.u;
	} else {
		return false;
	}
	
	return true;
}

// Takes gold from a player
function cantAfford(client, amount) {
	// Grab player ID
	var playerID = client.netprops.m_iPlayerID;
	if (playerID == -1) {
		return true;
	}
	
	// Grab and validate gold
	var gold = getClientGold(client);
	if(gold == null) {
		return true;
	}
	
	// They can't afford
	if(gold.r + gold.u < amount) {
		return true;
	}
	
	// Calculate new gold values
	gold.u -= amount;
	if(gold.u < 0) {
		gold.r += gold.u;
		gold.u = 0;
	}
	
	// Store new values
	return !setClientGold(client, gold);
}

// Gets a list of connected players who are playing
// Taken from WeaponMayhem
function getConnectedPlayingClients() {
	var client, playing = [];
	for (var i = 0; i < server.clients.length; ++i)
	{
		client = server.clients[i];

		if (client === null)
			continue;

		if (!client.isInGame())
			continue;

		playerID = client.netprops.m_iplayerID;
		if (playerID == -1)
			continue;

		// if (getPlayerResource(playerID, "m_iConnectionState") !== 2)
		// 	continue;

		playing.push(client);
	}
	return playing;
}

function CmdBuilder(client) {
	// Tell the client
	client.printToChat('Builder addon commands:');
	client.printToChat('-build, -upgrade, -heal, -give, -take, -select, -move');
}		

// Prints how to use the build command
function printBuildUsage(client) {
	client.printToChat('Usage: -build [building]');
	printBuildList(client);
}

function printBuildList(client) {
	client.printToChat('tower - '+COST_TOWER+' gold');
	client.printToChat('tp - (Teleporter Point) - '+COST_TP_POINT+' gold');
	client.printToChat('rax - (Spawns Creeps) - '+COST_RAX+' gold');
}