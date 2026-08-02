// DIG WARS — gem pickups & the satchel.
//
// ONE design language for the whole economy: every gem in the game — the
// crystal markings in rock faces, the pickups that pop out of them, and the
// loot a dead miner spills — is the same five-point gem-cut silhouette in
// one of four color families (copper / azurite / core shard / gold loot).
// See _depositsFor in public/client/terrainRenderer.js for the marking art;
// it uses this exact silhouette.
//
// Gem pickups are pure loot: nothing shoots them, they shoot nothing — all
// interaction happens in the gem pass of the terrain loop
// (server/game/terrain/gems.js).

// The canonical gem cut (unit coords): flat crown on top, pavilion point
// below. Mirrored on the client as GEM_CUT in terrainRenderer.js.
const GEM_CUT = [
    [-1, -0.38], [-0.55, -0.95], [0.55, -0.95], [1, -0.38], [0, 0.95],
];

// facet layers riding every pickup (attached as live Props in gems.js —
// entity define() doesn't instantiate PROPS)
Class.gemFacetCopper  = { SHAPE: GEM_CUT, COLOR: "#eda766", BORDERLESS: true };
Class.gemFacetVein    = { SHAPE: GEM_CUT, COLOR: "#7fb1f2", BORDERLESS: true };
Class.gemFacetShard   = { SHAPE: GEM_CUT, COLOR: "#d98af0", BORDERLESS: true };
Class.gemFacetEmerald = { SHAPE: GEM_CUT, COLOR: "#6ff5a8", BORDERLESS: true };
Class.gemFacetLoot    = { SHAPE: GEM_CUT, COLOR: "#f2cf7f", BORDERLESS: true };
Class.gemSparkle      = { SHAPE: GEM_CUT, COLOR: "#ffffff", BORDERLESS: true };

Class.gemPickupBase = {
    TYPE: "food",
    LABEL: "Gems",
    SHAPE: GEM_CUT,
    SIZE: 7,
    // slim outline — the fat default border swallowed the facets on small
    // pickups
    STROKE_WIDTH: 0.55,
    NO_COLLISIONS: true,
    IGNORED_BY_AI: true,
    DRAW_HEALTH: false,
    CAN_GO_OUTSIDE_ROOM: false,
    // lazy glinting spin — reads as treasure from across a tunnel
    FACING_TYPE: ["spin", { speed: 0.02 }],
    // fade out after ~90s so abandoned loot doesn't litter the world forever
    DIE_AT_RANGE: true,
    VARIES_IN_SIZE: false,
    HEALTH_WITH_LEVEL: false,
    DAMAGE_EFFECTS: false,
    BODY: {
        DAMAGE: 0,
        HEALTH: 1000,
        SPEED: 0,
        PUSHABILITY: 0,
        DENSITY: 1,
        RANGE: 2700,
    },
};

Class.gemPickupCopper = {
    PARENT: "gemPickupBase",
    LABEL: "Copper",
    COLOR: "#c96f2e",
    GLOW: { RADIUS: 0.8, COLOR: "#e8a05c", ALPHA: 0.3 },
};

Class.gemPickupVein = {
    PARENT: "gemPickupBase",
    LABEL: "Azurite",
    COLOR: "#3b7ce0",
    GLOW: { RADIUS: 1, COLOR: "#6fa3f2", ALPHA: 0.35 },
};

Class.gemPickupShard = {
    PARENT: "gemPickupBase",
    LABEL: "Core Shard",
    COLOR: "#b13ecf",
    GLOW: { RADIUS: 1.4, COLOR: "#e08af5", ALPHA: 0.45 },
};

// The big center crystal of a shard rock — the jackpot piece.
Class.gemPickupShardCore = {
    PARENT: "gemPickupBase",
    LABEL: "Core Shard",
    COLOR: "#b13ecf",
    GLOW: { RADIUS: 2, COLOR: "#e08af5", ALPHA: 0.55 },
};

// The rarest stone in the game — three cells per arena, deep at the spine.
// Reads richer than everything else: brightest glow, biggest cut.
Class.gemPickupEmerald = {
    PARENT: "gemPickupBase",
    LABEL: "Emerald",
    COLOR: "#1fbf6b",
    GLOW: { RADIUS: 1.8, COLOR: "#6ff5a8", ALPHA: 0.55 },
};

// The big center emerald — the trophy piece.
Class.gemPickupEmeraldCore = {
    PARENT: "gemPickupBase",
    LABEL: "Emerald",
    COLOR: "#1fbf6b",
    GLOW: { RADIUS: 2.4, COLOR: "#6ff5a8", ALPHA: 0.65 },
};

// Dropped by dying players — a jackpot pile, gold so it reads as "loot"
// from across the map.
Class.gemPickupLoot = {
    PARENT: "gemPickupBase",
    LABEL: "Dropped Gems",
    COLOR: "#e0a63b",
    GLOW: { RADIUS: 1.2, COLOR: "#f5cf6e", ALPHA: 0.4 },
};

// The hoard jewel: a gem socketed dead-center on the hull — wealth worn
// as a crown jewel. Attached as Props at spawn; bound.size is driven live
// by carried-gem load (starts tiny with the first find, grows fat when
// rich; blinks red at cap, client-side). It rides the hull's facing, so
// it aims with the cursor and spins with rammers/autospin. Team-colored:
// blue team wears emerald, red team wears core-shard purple. Everyone can
// see how rich you are — that's the point.
Class.gemHoardEmerald = {
    LABEL: "Hoard",
    SHAPE: GEM_CUT,
    COLOR: "#1fbf6b",
    STROKE_WIDTH: 1.1,
};
Class.gemHoardEmeraldFacet = { LABEL: "Hoard", SHAPE: GEM_CUT, COLOR: "#6ff5a8", BORDERLESS: true };
Class.gemHoardShard = {
    LABEL: "Hoard",
    SHAPE: GEM_CUT,
    COLOR: "#b13ecf",
    STROKE_WIDTH: 1.1,
};
Class.gemHoardShardFacet = { LABEL: "Hoard", SHAPE: GEM_CUT, COLOR: "#d98af0", BORDERLESS: true };

// ─── FORWARD OUTPOSTS ────────────────────────────────────────────────────
// The outpost structure: a permanent mini-base standing on each site —
// grey while neutral, team-colored once conquered. You take it by
// DESTROYING it (it rebuilds instantly in the killer team's colors).
// Weaponless and immovable, and with near-zero density so it never shoves
// bodies away — rammers grind it point-blank and teammates can sit on it.
// Styled after the vault: octagonal foundation, recessed plate, gold gem
// crest.
Class.outpostBanner = {
    PARENT: "genericTank",
    LABEL: "Outpost",
    TYPE: "miniboss",
    ON_MINIMAP: false,
    DANGER: 5,
    LEVEL: 45,
    LEVEL_CAP: 45,
    SIZE: 60,
    // a compact slowly-spinning octagon — the client mounts the mini vault
    // door on top. (Octagon matches the vault's foundation language; 70%
    // of the former hexagon's size keeps the pad tight and readable.)
    SHAPE: 8,
    // No INTANGIBLE: enemies are physically BLOCKED by the structure (like a
    // wall), while teammates pass straight through (handled in the collision
    // dispatcher). The structure deals ZERO body damage, so ramming it is
    // free — you just can't walk through it. Projectiles burst on its hide
    // instead of piercing through.
    BODY: {
        RESIST: 50,
        SPEED: 0,
        ACCELERATION: 0,
        // DAMAGE 0: ramming it costs you NOTHING — and it also means the
        // engine's mutual-death scaling can't shrink incoming bullet damage
        // (a bullet the structure instakilled only delivered a sliver of
        // its damage — that was the "1000 bullets to kill" bug). Bullets
        // are killed manually in the collision dispatcher instead.
        HEALTH: 9000,
        DAMAGE: 0,
        PENETRATION: 0.25,
        FOV: 0.5,
        PUSHABILITY: 0,
        REGEN: 0,
        SHIELD: 0,
    },
    FACING_TYPE: ["spin", { speed: 0.02 }],
    CONTROLLERS: [],
    // the client's label above the door is the ONE name — no nameplate
    DISPLAY_NAME: false,
    DRAW_HEALTH: true,
    CAN_BE_ON_LEADERBOARD: false,
    GIVE_KILL_MESSAGE: false,
    ACCEPTS_SCORE: false,
    IGNORED_BY_AI: true,
    HITS_OWN_TYPE: "pushOnlyTeam",
};
