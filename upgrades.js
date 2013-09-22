// Hook stuff
game.hook('Dota_OnGetAbilityValue', onGetAbilityValue);

// How much the vision the vision upgrade adds
INCREASE_VISION_RANGE = 300;

// Base Values
var BASE_HEALTH = 1300;
//var BASE_ARMOR = 20;
//var BASE_DAMAGE = 110;

// Increase per level
var INCREASE_HEALTH = 300;
var INCREASE_ARMOR = 1;
var INCREASE_DAMAGE = 20;
var LIFE_STEAL_INCREASE = 2;
var MANABURN_INCREASE = 2;

// Used for making custom tower items
var modValues = false;
var newDamage = 0;
var newArmor = 0;

var RUNE_SPAWN_DELAY = 60000;		// Delay in ms for a rune to be added to the spawn queue
var RUNE_SPAWN_CHECK = 10000;		// Delay in ms to check if we should spawn a rune, or not

exports.makeInvisArray = new Array();

// We need certain heros particle files to be loaded
dota.loadParticleFile('particles/units/heroes/hero_viper.pcf');
dota.loadParticleFile('particles/units/heroes/hero_abaddon.pcf');

// Map of upgrades
exports.upgradeMap = {
	// TOWER BUILDING
	npc_dota_tower: new Array(
		{
			name: 'level',
			desc: 'Adds '+INCREASE_HEALTH+' hp, '+INCREASE_ARMOR+' armor and '+INCREASE_DAMAGE+' damage',
			cost: 500,
			max: 20,
			effect: function(ent, name, client) {
				// Workout the new level
				var newLevel = ent.netprops.m_iCurrentLevel+1;
				
				// Up the level on the tower
				setTowerLevel(ent, newLevel);
			}
		},
		
		{
			name: 'lifesteal',
			desc: 'Restores '+LIFE_STEAL_INCREASE+'% of damage per attack',
			cost: 800,
			max: 5,
			effect: function(ent, name, client, currentLevel) {
				// Store the lifesteal affect
				ent.lifestealBonus = LIFE_STEAL_INCREASE * (currentLevel+1);
			}
		},
		
		{
			name: 'manaburn',
			desc: 'Burns '+MANABURN_INCREASE+' mana per attack',
			cost: 800,
			max: 5,
			effect: function(ent, name, client, currentLevel) {
				// Store the manasteal bonus
				ent.manaburnBonus = MANABURN_INCREASE * (currentLevel+1);
			}
		},
		
		{
			name: 'acid',
			desc: 'Damages and slows enemies when they attack it',
			cost: 1500,
			max: 4,
			effect: function(ent, name, client, currentLevel) {
				// Grab the stat modifier
				if(!ent.acidModder) {
					// Add acid skill
					ent.acidModder = dota.createAbility(ent, 'viper_corrosive_skin');
					
					// Find the first free slot for this skill
					for(var i=0;i<16;i++) {
						if(ent.netprops.m_hAbilities[i] == null) {
							dota.setAbilityByIndex(ent, ent.acidModder, i);
							break;
						}
					}
				} else {
					dota.removeModifier(ent, 'modifier_viper_corrosive_skin');
				}
				
				// Level up the ability
				ent.acidModder.netprops.m_iLevel = currentLevel+1;
				
				// Apply the mod
				dota.addNewModifier(ent, ent.acidModder, 'modifier_viper_corrosive_skin', "viper_corrosive_skin", {});
			}
		},
		
		{
			name: 'borrowedtime',
			desc: 'Adds a modified version of abaddon\'s ult',
			cost: 3000,
			max: 3,
			effect: function(ent, name, client, currentLevel) {
				// Grab the stat modifier
				if(!ent.borrowedtimeModder) {
					// Add acid skill
					ent.borrowedtimeModder = dota.createAbility(ent, 'abaddon_borrowed_time');
					
					// Find the first free slot for this skill
					for(var i=0;i<16;i++) {
						if(ent.netprops.m_hAbilities[i] == null) {
							dota.setAbilityByIndex(ent, ent.borrowedtimeModder, i);
							break;
						}
					}
				}
				
				// Level up the ability
				ent.borrowedtimeModder.netprops.m_iLevel = currentLevel+1;
				
				// Store duration
				if(currentLevel == 0) {
					ent.borrowedtimeModder.duration = 3;
				}else if(currentLevel == 1) {
					ent.borrowedtimeModder.duration = 4;
				} else {
					ent.borrowedtimeModder.duration = 5;
				}
				
				// Store cooldown
				ent.borrowedtimeModder.cooldown = 120;
			}
		}
	),
	
	// FORT BUILDING
	npc_dota_fort: new Array(
		{
			name: 'hp',
			desc: 'Adds '+INCREASE_HEALTH+' hp',
			cost: 500,
			max: 20,
			effect: function(ent, name, client) {
				// Add to the max HP
				
				// Grab health stats
				ent.netprops.m_iMaxHealth += INCREASE_HEALTH;
				ent.netprops.m_iHealth += INCREASE_HEALTH;
			}
		}
	),
	
	// DOTA BARRACKS BUILDING
	npc_dota_barracks: new Array(
		{
			name: 'hp',
			desc: 'Adds '+INCREASE_HEALTH+' hp',
			cost: 500,
			max: 20,
			effect: function(ent, name, client) {
				// Add to the max HP
				
				// Grab health stats
				ent.netprops.m_iMaxHealth += INCREASE_HEALTH;
				ent.netprops.m_iHealth += INCREASE_HEALTH;
			}
		}
	),
	
	// RAX BUILDING
	npc_dota_building_rax: new Array(
		{
			name: 'melee',
			desc: 'Creep type becomes Melee',
			cost: 100,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
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
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'ranged',
			desc: 'Creep type becomes Ranged',
			cost: 150,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_creep_badguys_ranged',
					'npc_dota_creep_badguys_ranged',
					'npc_dota_creep_badguys_ranged'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_creep_goodguys_ranged',
					'npc_dota_creep_goodguys_ranged',
					'npc_dota_creep_goodguys_ranged'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'fel',
			desc: 'Creep type becomes Fel Ghosts',
			cost: 450,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_fel_beast',
					'npc_dota_neutral_fel_beast',
					'npc_dota_neutral_fel_beast'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_fel_beast',
					'npc_dota_neutral_fel_beast',
					'npc_dota_neutral_fel_beast'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'kobold',
			desc: 'Creep type becomes Kobold Rats',
			cost: 500,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_kobold',
					'npc_dota_neutral_kobold_tunneler',
					'npc_dota_neutral_kobold_taskmaster'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_kobold',
					'npc_dota_neutral_kobold_tunneler',
					'npc_dota_neutral_kobold_taskmaster'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'wolf',
			desc: 'Creep type becomes Wolves',
			cost: 600,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_giant_wolf',
					'npc_dota_neutral_alpha_wolf'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_giant_wolf',
					'npc_dota_neutral_alpha_wolf'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'megamelee',
			desc: 'Creep type becomes Mega Melee',
			cost: 650,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_creep_badguys_melee_upgraded',
					'npc_dota_creep_badguys_melee_upgraded',
					'npc_dota_creep_badguys_melee_upgraded'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_creep_goodguys_melee_upgraded',
					'npc_dota_creep_goodguys_melee_upgraded',
					'npc_dota_creep_goodguys_melee_upgraded'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'megaranged',
			desc: 'Creep type becomes Mega Ranged',
			cost: 650,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_creep_badguys_ranged_upgraded',
					'npc_dota_creep_badguys_ranged_upgraded',
					'npc_dota_creep_badguys_ranged_upgraded'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_creep_goodguys_ranged_upgraded',
					'npc_dota_creep_goodguys_ranged_upgraded',
					'npc_dota_creep_goodguys_ranged_upgraded'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'centaur',
			desc: 'Creep type becomes Centaur Horses',
			cost: 750,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_centaur_outrunner',
					'npc_dota_neutral_centaur_khan'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_centaur_outrunner',
					'npc_dota_neutral_centaur_khan'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'polar',
			desc: 'Creep type becomes Polar Bears',
			cost: 750,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_polar_furbolg_champion',
					'npc_dota_neutral_polar_furbolg_ursa_warrior'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_polar_furbolg_champion',
					'npc_dota_neutral_polar_furbolg_ursa_warrior'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'wildkin',
			desc: 'Creep type becomes Wildkin Birds',
			cost: 750,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_wildkin',
					'npc_dota_neutral_wildkin',
					'npc_dota_neutral_enraged_wildkin'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_wildkin',
					'npc_dota_neutral_wildkin',
					'npc_dota_neutral_enraged_wildkin'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'satyr',
			desc: 'Creep type becomes Satyr',
			cost: 750,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_satyr_soulstealer',
					'npc_dota_neutral_satyr_hellcaller'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_satyr_soulstealer',
					'npc_dota_neutral_satyr_hellcaller'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'mud',
			desc: 'Creep type becomes Mud Golems',
			cost: 1000,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_mud_golem',
					'npc_dota_neutral_mud_golem'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_mud_golem',
					'npc_dota_neutral_mud_golem'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'ogre',
			desc: 'Creep type becomes Ogres',
			cost: 1000,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_ogre_mauler',
					'npc_dota_neutral_ogre_mauler',
					'npc_dota_neutral_ogre_magi'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_ogre_mauler',
					'npc_dota_neutral_ogre_mauler',
					'npc_dota_neutral_ogre_magi'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'stalker',
			desc: 'Creep type becomes Flying Stalker Ancient',
			cost: 1500,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_jungle_stalker',
					'npc_dota_neutral_elder_jungle_stalker'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_jungle_stalker',
					'npc_dota_neutral_elder_jungle_stalker'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'dragonkin',
			desc: 'Creep type becomes Dragonkin Ancient',
			cost: 2500,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_blue_dragonspawn_sorcerer',
					'npc_dota_neutral_blue_dragonspawn_overseer'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_blue_dragonspawn_sorcerer',
					'npc_dota_neutral_blue_dragonspawn_overseer'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'golem',
			desc: 'Creep type becomes Rock Golem Ancient',
			cost: 2500,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_rock_golem',
					'npc_dota_neutral_rock_golem',
					'npc_dota_neutral_granite_golem'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_rock_golem',
					'npc_dota_neutral_rock_golem',
					'npc_dota_neutral_granite_golem'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		},
		
		{
			name: 'lizard',
			desc: 'Creep type becomes Lizard Ancient',
			cost: 2500,
			unique: 'Active Creep',
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_neutral_small_thunder_lizard',
					'npc_dota_neutral_small_thunder_lizard',
					'npc_dota_neutral_big_thunder_lizard'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_neutral_small_thunder_lizard',
					'npc_dota_neutral_small_thunder_lizard',
					'npc_dota_neutral_big_thunder_lizard'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			}
		}/*,
		
		{
			name: 'necronomicon',
			desc: 'Change the creep type to Lizard (Lizard Ancient).',
			cost: 1,
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_necronomicon_warrior_3',
					'npc_dota_necronomicon_archer_3'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_necronomicon_warrior_3',
					'npc_dota_necronomicon_archer_3'
				);
				
				// No custom flags
				ent.CustomNetprops = null;
			},
			pass: function(ent) {
				for(var i=0;i<16;i++) {
					var ab = ent.netprops.m_hAbilities[i];
					
					if(ab) {
						dota.levelUpAbility(ent, ab);
					}
				}
				
			}
		}*//*,
		
		{
			name: 'roshan',
			desc: 'Change the creep type to Roshan.',
			cost: 1,
			effect: function(ent, name, client) {
				ent.CampSpawnBad = new Array(
					'npc_dota_roshan'
				);
				
				ent.CampSpawnGood = new Array(
					'npc_dota_roshan'
				);
				
				// NERF ROSHAN
				ent.CustomNetprops = {
					m_iHealth: 1500,
					m_iMaxHealth: 1500
				}
			}
		}*/
	),
	
	// TELEPORTER BUILDING
	npc_dota_building_teleporter: new Array(
		// Invisibiltiy Upgrade
		/*{
			name: 'invis',
			desc: 'Makes the building invisible.',
			cost: 1,
			effect: function(ent, name, client) {
				// Make invisble
				makeInvisArray.push(ent);
				
				var invis = dota.createAbility(ent, 'riki_permanent_invisibility');
				dota.levelUpAbility(ent, invis);
				
				// Stop the client from buying it again
				ent.NoBuy[name] = true;
			}
		},*/
		
		// Vision Upgrade
		{
			name: 'vision',
			desc: 'Increases the vision of this building by '+INCREASE_VISION_RANGE+' units.',
			cost: 150,
			max: 3,
			effect: function(ent, name, client) {
				// Do the upgrade
				ent.netprops.m_iDayTimeVisionRange += INCREASE_VISION_RANGE;
				ent.netprops.m_iNightTimeVisionRange += INCREASE_VISION_RANGE;
			}
		},
		
		// Rune Spawner upgrade
		{
			name: 'rune',
			desc: 'Makes runes spawn near this building every 60 seconds.',
			cost: 500,
			max: 1,
			effect: function(ent, name, client) {
				// Set the initial angle
				var sort = 0;
				
				var count = {
					0:0,
					1:0,
					2:0,
					3:0,
					4:0
				};
				
				var runes = {
					0:null,
					1:null,
					2:null,
					3:null,
					4:null
				};
				
				var timer;
				var timer2;
				
				timer = timers.setInterval(function() {
					count[sort] += 1;
					sort += 1;
					if(sort > 4) {
						sort = 0;
					}
				}, RUNE_SPAWN_DELAY);
				
				timer2 = timers.setInterval(function() {
					if(ent && ent.isValid() && ent.wasBuilt) {
						for(var i=0; i<5; i++) {
							if(count[i] <= 0) {
								continue;
							}
							
							// Try to find the rune
							var found = false;
							if(runes[i]) {
								var allRunes = game.findEntitiesByClassname('dota_item_rune');
								
								for(var j=0;j<allRunes.length;j++) {
									if(runes[i] == allRunes[j]) {
										found = true;
										break;
									}
								}
							}
							
							// Create a rune if the old one wasnt found
							if(!found) {
								// Create a rune
								var rune = GrabRune();
								if(rune) {
									// Set the rune type
									dota.setRuneType(rune, i);
									
									// Grab the position of the rune spawner
									var pos = ent.netprops.m_vecOrigin;
									
									// Grab position
									var x = Math.round(pos.x + RUNE_DISTANCE*Math.cos(toRadians(i*360/5)));
									var y = Math.round(pos.y + RUNE_DISTANCE*Math.sin(toRadians(i*360/5)));
									var z = pos.z;
									
									// Move it into position
									rune.teleport(x, y, z);
									
									// Store rune
									runes[i] = rune;
									
									// Decrease number of runes to spawn
									count[i] -= 1;
								}
							}
						}
					} else {
						timer.clearTimer(timer)
					}
				}, RUNE_SPAWN_CHECK);
				
				// Store timer onto ent
				ent.timer = timer;
				ent.timer2 = timer2;
			}
		},
		
		// Shop upgrade
		{
			name: 'shop',
			desc: 'Makes this building into a shop. (Use -shop to open)',
			cost: 500,
			max: 1,
			effect: function(ent, name, client) {
				// Enable the effect
				ent.isShop = true;
				
				// Put it into our list of shops
				shopList.push(ent);
				
				// Tell the client how to use it
				client.printToChat('Use -shop to enter the shop, or just buy something.');
			}
		}
	)
};

exports.setTowerLevel = function(tower, level) {
	if(!tower || !tower.isValid()) return;
	
	// Grab health stats
	var oldMaxHealth = tower.netprops.m_iMaxHealth;
	var oldHealth = tower.netprops.m_iHealth;
	
	// Workout how much damage has been done
	var towerDamage = oldMaxHealth - oldHealth;
	
	// Set level
	tower.netprops.m_iCurrentLevel = level;
	
	// No free stats for the first level
	var scale = level - 1;
	
	// Set new health
	tower.netprops.m_iMaxHealth = BASE_HEALTH + scale * INCREASE_HEALTH;
	tower.netprops.m_iHealth = tower.netprops.m_iMaxHealth - towerDamage;
	
	// Workout how much bonus damage to give the tower
	newDamage = scale * INCREASE_DAMAGE;
	
	// Workout how much bonus armor to give the tower
	newArmor = scale * INCREASE_ARMOR;
	
	// Grab the stat modifier
	if(!tower.statModder) {
		tower.statModder = dota.createAbility(tower, 'item_blade_mail');
	} else {
		dota.removeModifier(tower, 'modifier_item_blade_mail');
	}
	
	// Change values of blademail
	modValues = {
		'bonus_damage': newDamage,
		'bonus_armor': newArmor,
		'bonus_intellect': 0
	};
	
	// Apply the mod
	dota.addNewModifier(tower, tower.statModder, 'modifier_item_blade_mail', "item_blade_mail", {});
	
	// Reset mod values
	modValues = false;
}

// Convert degrees to radians
function toRadians (angle) {
	return angle * (Math.PI / 180);
}

function onGetAbilityValue(ent, name, field, values) {
	// Check for custom values
	if(modValues) {
		if(modValues[field] != null) {
			// Mod the value
			values[0] = modValues[field];
			
			// Do the change
			return values;
		} else {
			server.print('MISSED FIELD '+field);
		}
	}
}

// Spawns a rune, and returns it
function GrabRune() {
	// Grab a copy of the original runes
	var oldRunes = game.findEntitiesByClassname('dota_item_rune');
	
	// Spawn a new rune
	dota.spawnRune();
	
	// Grab the new runes
	var runes = game.findEntitiesByClassname('dota_item_rune');
	
	// Attempt to find the rune that just spawned
	for(var i=runes.length-1;i>=0;i--) {
		var rune = runes[i];
		
		// Work backwards through the array looking for one that isn't in the oldRunes array
		if(oldRunes.indexOf(rune) == -1) {
			return rune;
		}
	}
	
	return null;
}
