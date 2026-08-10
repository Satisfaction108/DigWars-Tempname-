# Bot tank checklist (max-tier tanks, reachable in dig wars)

This is an allowlist: every tank below is a **final / max-level** upgrade that a normal
(non-dev) player can actually reach in the current dig wars upgrade tree. Nothing
upgrades out of these. Put an `x` inside the brackets for any tank bots **should not
use**:

```md
- [x] Necromancer (`necromancer`)
- [ ] Spike (`spike`)
```

The class ID in backticks is included so the selection can be applied without ambiguity.

## Max-tier tanks

- [x] Ambulance (`ambulance`)
- [ ] Annihilator (`annihilator`)
- [x] Architect (`architect`)
- [ ] Armsman (`armsman`)
- [ ] Assembler (`assembler`)
- [ ] Atomizer (`atomizer`)
- [ ] Auto-4 (`auto4`)
- [ ] Auto-5 (`auto5`)
- [ ] Auto-Assassin (`autoAssassin`)
- [ ] Auto-Builder (`autoBuilder`)
- [x] Auto-Cruiser (`autoCruiser`)
- [ ] Auto-Double (`autoDouble`)
- [ ] Auto-Gunner (`autoGunner`)
- [x] Auto-Overseer (`autoOverseer`)
- [x] Auto-Smasher (`autoSmasher`)
- [x] Auto-Spawner (`autoSpawner`)
- [ ] Auto-Tri-Angle (`autoTriAngle`)
- [ ] Banshee (`banshee`)
- [ ] Barricade (`barricade`)
- [ ] Battleship (`battleship`)
- [ ] Beekeeper (`beekeeper`)
- [ ] Bent Double (`bentDouble`)
- [ ] Bent Hybrid (`bentHybrid`)
- [x] Big Cheese (`bigCheese`)
- [ ] Bomber (`bomber`)
- [ ] Boomer (`boomer`)
- [x] Booster (`booster`)
- [ ] Bulwark (`bulwark`)
- [ ] Bushwhacker (`bushwhacker`)
- [x] Carrier (`carrier`)
- [ ] Commander (`commander`)
- [ ] Conqueror (`conqueror`)
- [ ] Construct (`construct`)
- [ ] Crop Duster (`cropDuster`)
- [ ] Crossbow (`crossbow`)
- [ ] Cyclone (`cyclone`)
- [x] Deadeye (`deadeye`)
- [ ] Dual (`dual`)
- [x] Eagle (`eagle`)
- [x] Engineer (`engineer`)
- [ ] Factory (`factory`)
- [ ] Falcon (`falcon`)
- [ ] Field Gun (`fieldGun`)
- [ ] Fighter (`fighter`)
- [x] Flace (`flace`)
- [x] Flamethrower (`flamethrower`)
- [ ] Focal (`focal`)
- [x] Fork (`fork`)
- [x] Fortress (`fortress`)
- [ ] Gunner Trapper (`gunnerTrapper`)
- [x] Half 'n Half (`halfNHalf`)
- [ ] Hewn Double (`hewnDouble`)
- [ ] Hexa-Trapper (`hexaTrapper`)
- [ ] Hybrid (`hybrid`)
- [x] Infestor (`infestor`)
- [x] Landmine (`landmine`)
- [ ] Machine Gunner (`machineGunner`)
- [ ] Manager (`manager`)
- [x] Maleficitor (`maleficitor`)
- [x] Medic (`medic`)
- [x] Mega Auto-Trapper (`megaAutoTrapper`)
- [ ] Mega Smasher (`megaSmasher`)
- [ ] Mega-3 (`mega3`)
- [ ] Mortar (`mortar`)
- [ ] Musket (`musket`)
- [ ] Nailgun (`nailgun`)
- [x] Necromancer (`necromancer`)
- [x] Nimrod (`nimrod`)
- [ ] Octo Tank (`octoTank`)
- [ ] Ordnance (`ordnance`) - this is ordinance not ordnance?
- [ ] Overdrive (`overdrive`)
- [ ] Overgunner (`overgunner`)
- [ ] Overlord (`overlord`)
- [ ] Overtrapper (`overtrapper`)
- [x] Paramedic (`paramedic`)
- [ ] Penta Shot (`pentaShot`)
- [ ] Phoenix (`phoenix`)
- [ ] Poacher (`poacher`)
- [ ] Predator (`predator`)
- [x] Quadruplex (`quadruplex`)
- [ ] Ranger (`ranger`)
- [ ] Redistributor (`redistributor`)
- [x] Revolver (`revolver`)
- [x] Septa-Trapper (`septaTrapper`)
- [ ] Shotgun (`shotgun`)
- [ ] Sidewinder (`sidewinder`)
- [ ] Single (`single`)
- [ ] Skimmer (`skimmer`)
- [ ] Spike (`spike`)
- [x] Splasher (`splasher`)
- [ ] Spreadshot (`spreadshot`)
- [x] Stalker (`stalker`)
- [ ] Streamliner (`streamliner`)
- [x] Subverter (`subverter`)
- [ ] Surfer (`surfer`)
- [x] Surgeon (`surgeon`)
- [ ] Swarmer (`swarmer`)
- [x] Tri-Blaster (`triBlaster`)
- [x] Triple Auto-Trapper (`tripleAutoTrapper`)
- [x] Triple Machine (`tripleMachine`)
- [ ] Triple Twin (`tripleTwin`)
- [ ] Triplet (`triplet`)
- [x] Triplex (`triplex`)
- [ ] Twister (`twister`)
- [x] Vulture (`vulture`)
- [ ] X-Hunter (`xHunter`)

## Notes

- Sourced from the live tree in `server/lib/definitions/groups/tanks.js`, using the
  dig wars settings (`arms_race: false`, `siege` off).
- Excluded because they are not reachable in this config: the whole whirlwind and
  flail branches (Whirlwind, Flail, Tornado, Hurricane, Maelstrom, Munition, Prophet,
  Typhoon, Blizzard, Tempest, Thunderbolt, Triple Flail, Big Mama, Flace, Flooster,
  and so on), siege-only Healer/Medic/Ambulance/Surgeon/Paramedic branch, and
  arms-race-only additions (Bonker, Battery, Blower, Death Star).
- Mark unwanted tanks with `[x]`. The bot selector will be updated after you finish
  marking them.