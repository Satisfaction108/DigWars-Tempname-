// Render exposes a single port and sets RENDER_EXTERNAL_URL automatically.
// PUBLIC_HOST is an optional manual override for custom domains.
const publicHost = (
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.PUBLIC_HOST ? `https://${process.env.PUBLIC_HOST}` : "")
).replace(/^https?:\/\//, "");

module.exports = {

    devBuild: false,

    main_menu: 'index.html',
    host: publicHost || 'localhost:3000',
    port: parseInt(process.env.PORT) || 3000,

    visible_list_interval: 250,
    startup_logs: true,
    load_all_mockups: false,

    servers: [
        {
            // Render runs one process on one exposed port, so the game server
            // must share the lobby's port/process there. Set SINGLE_PROCESS=true
            // as an env var on Render (locally this stays false / worker mode).
            share_client_server: process.env.SINGLE_PROCESS === "true",

            host: publicHost || 'localhost:3100',
            port: process.env.SINGLE_PROCESS === "true" ? (parseInt(process.env.PORT) || 3000) : 3100,
            id: 'dw',

            region: "Local",
            gamemode: ['dig_wars'],
            player_cap: 16,

            featured: true,
            unlisted: false,
            private: false,

            properties: {
                teams: 2,
                bot_cap: 0
            }
        },
    ],

    allow_ACAO: false,

    map_tile_width: 420,
    map_tile_height: 420,

    spawn_message: "You have spawned! Welcome to the game.\n"
                 + "You will be invulnerable until you move or shoot.\n"
                 + "Please report any bugs you encounter!",
    token_message: "Friendly reminder: Please do not repeatedly kill others with an overpowered tank.",

    chat_message_duration: 9_000,
    popup_message_duration: 10_000,
    sanitize_chat_input: true,

    fireworks: false,
    thanksgiving: false,
    spooky_theme: false,

    game_speed: 1,
    run_speed: 1.5,
    max_heartbeat_interval: 300_000,
    respawn_delay: 0,

    bullet_spawn_offset: 1,
    damage_multiplier: 1,
    knockback_multiplier: 1.1,
    glass_health_factor: 2,
    room_bound_force: 0.01,
    soft_max_skill: 0.59,

    defineLevelSkillPoints: level => {
        if (level < 2) return 0;
        if (level <= 40) return 1;
        if (level <= 45 && level & 1 === 1) return 1;
        return 0;
    },

    level_cap: 100,
    level_cap_cheat: 45,

    // DIG WARS: everyone spawns straight at level 45, full size, with all
    // skill points — progression lives in the gem economy, not levels.
    spawn_at_max_level: true,
    // The old level-up paths (options-menu checkbox + 'L' key) — disabled,
    // not removed. Flip to true to bring manual leveling back.
    manual_level_up: false,
    // Incognito is gone in Dig Wars — wealth is public by design. The
    // client UI no longer offers it; this also ignores the spawn flag.
    allow_incognito: false,

    skill_cap: 9,
    tier_cap: 100,
    tier_multiplier: 15,

    bot_cap: 0,
    bot_xp_gain: 60,
    bot_start_level: 100,
    bot_skill_upgrade_chances: [1, 1, 3, 4, 4, 4, 4, 2, 1, 1],
    bot_class_upgrade_chances: [1, 5, 20, 37, 37],
    bot_name_prefix: "[AI] ",

    spawn_class: 'basic',

    regenerate_tick: 100,

    enable_food: true,
    food_cap: 70,
    food_cap_nest: 15,
    enemy_cap_nest: 10,
    food_group_cap: 6,

    food_types: Array(3).fill().map((_, i, a) => [

        4 ** (a.length - i),

        Array(3).fill().map((_, j, b) => [

            5 ** (b.length - j),

            Array(6).fill().map((_, k, c) => [

                k ? 10 ** (c.length - k - 1) : 200_000_000,

                [
                    [24, `laby_${i}_${j}_${k}_0`],

                ]
            ])
        ])
    ]),
    food_types_nest: Array(2).fill().map((_, i, a) => [

        4 ** (a.length - i),

        Array(3).fill().map((_, j, b) => [

            5 ** (b.length - j),

            Array(6).fill().map((_, k, c) => [

                k ? 10 ** (c.length - k - 1) : 200_000_000,

                [
                    [24, `laby_${i + 3}_${j}_${k}_0`],

                ]
            ])
        ])
    ]),

    classic_food: true,
    classic_food_types: [
        [1, [
            [65, 'egg'], [64, 'triangle'], [45, 'square'], [7, 'pentagon']
        ]],
        [1/50000, [
            [625, 'gem'], [125, 'shinyTriangle'], [25, 'shinySquare'], [5, 'shinyPentagon']
        ]],
        [1/1000000, [
            [1296, 'jewel'], [216, 'legendaryTriangle'], [36, 'legendarySquare'], [6, 'legendaryPentagon']
        ]]
    ],
    classic_food_types_nest: [
        [1, [
            [16, 'pentagon'], [4, 'betaPentagon'], [1, 'alphaPentagon']
        ]]
    ],
    classic_enemy_types_nest: [
        [1, [
            [1, 'crasher']
        ]],
        [1/20, [
            [1, 'sentryGun'], [1, 'sentrySwarm'], [1, 'sentryTrap']
        ]]
    ],

    enable_bosses: false,
    boss_spawn_cooldown: 20,
    boss_spawn_delay: 6,
    boss_types: [

        {
            bosses: ['paladin', 'freyja', 'zaphkiel', 'nyx', 'theia'],
            amount: [1], chance: 50,
            message: 'The world tremors as the celestials are reborn anew!',
        },
        {
            bosses: ['julius', 'genghis', 'napoleon'],
            amount: [1], chance: 50,
            message: 'The darkness arrives as the realms are torn apart!',
        }
    ],

    team_weights: {},

    brain_damage: false,
    random_body_colors: false,

    gamemode_name_prefixes: [],
    arena_shape: 'rect',
    arms_race: true,
    blackout: false,
    clan_wars: false,
    diep: false,
    domination: false,
    growth: false,
    groups: false,
    march_madness: false,
    mode: 'tdm',
    mothership: false,
    siege: false,
    space_physics: false,
    spawn_confinement: {},
    tag: false,
    teams: 2,
    train: false,
    use_limited_waves: false,

    room_setup: ['room_default'],
}
