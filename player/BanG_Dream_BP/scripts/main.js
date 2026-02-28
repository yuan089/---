import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

// --- [數據中心] ---
const DISC_MAP = {}; 
const ACTIVE_JUKEBOXES = new Map(); // 內存計時器: key -> { dimId, x, y, z, timer }

// --- [核心：DLC 註冊系統] ---
system.afterEvents.scriptEventReceive.subscribe((e) => {
    if (e.id === "bangdream:register") {
        try {
            const d = JSON.parse(e.message);
            DISC_MAP[d.id] = { sound: d.sound, name: d.name, duration: parseInt(d.dur), keywords: (d.keywords || "").toLowerCase() };
        } catch (err) {}
    }
});

function getBlockKey(dim, x, y, z) { return `jb:${dim}:${x}:${y}:${z}`; }

// --- [核心工具：強力清理] ---
function stopAndCleanup(dimension, x, y, z, dbKey) {
    try {
        const currentSound = world.getDynamicProperty(dbKey + "_cur_s");
        if (currentSound) dimension.runCommand(`stopsound @a ${currentSound}`);
        
        dimension.runCommand(`execute positioned ${x} ${y} ${z} run playanimation @e[type=parrot,r=15] animation.parrot.moving reset 0`);
        
        const savedId = world.getDynamicProperty(dbKey);
        if (savedId) {
            const itemToSpawn = new ItemStack(savedId, 1);
            const listData = world.getDynamicProperty(dbKey + "_list");
            if (savedId === "bangdream:cassette" && listData) itemToSpawn.setDynamicProperty("playlist", listData);
            dimension.spawnItem(itemToSpawn, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
        }
        ACTIVE_JUKEBOXES.delete(dbKey);
        world.setDynamicProperty(dbKey, undefined);
        world.setDynamicProperty(dbKey + "_list", undefined);
        world.setDynamicProperty(dbKey + "_index", undefined);
        world.setDynamicProperty(dbKey + "_cur_n", undefined);
        world.setDynamicProperty(dbKey + "_cur_s", undefined);
        world.setDynamicProperty(dbKey + "_t", undefined);
    } catch (e) {}
}

// --- [組件註冊：唱片機與刻錄機] ---
world.beforeEvents.worldInitialize.subscribe((e) => {
    e.blockComponentRegistry.registerCustomComponent("bangdream:jukebox_logic", {
        onPlayerInteract: (ev) => {
            const { block, player, dimension } = ev;
            const { x, y, z } = block.location;
            const dbKey = getBlockKey(dimension.id, x, y, z);
            const savedId = world.getDynamicProperty(dbKey);
            if (!savedId) {
                const inv = player.getComponent("minecraft:inventory").container;
                const item = inv.getItem(player.selectedSlotIndex);
                if (item && (DISC_MAP[item.typeId] || item.typeId === "bangdream:cassette" || item.typeId.startsWith("minecraft:music_disc"))) {
                    system.run(() => {
                        world.setDynamicProperty(dbKey, item.typeId);
                        if (item.typeId === "bangdream:cassette") {
                            world.setDynamicProperty(dbKey + "_list", item.getDynamicProperty("playlist") || "[]");
                            world.setDynamicProperty(dbKey + "_index", 0);
                        }
                        block.setPermutation(block.permutation.withState("bangdream:has_disc", true));
                        // 初始計時器設為 0 以觸發立即播放
                        ACTIVE_JUKEBOXES.set(dbKey, { dimId: dimension.id, x, y, z, timer: 0 });
                        if (player.gameMode !== "creative") inv.setItem(player.selectedSlotIndex, undefined);
                    });
                }
            } else {
                system.run(() => {
                    stopAndCleanup(dimension, block.location.x, block.location.y, block.location.z, dbKey);
                    if (block.isValid()) block.setPermutation(block.permutation.withState("bangdream:has_disc", false));
                });
            }
        }
    });

    e.blockComponentRegistry.registerCustomComponent("bangdream:keluji_logic", {
        onPlayerInteract: (ev) => {
            const { block, player } = ev;
            const item = player.getComponent("minecraft:inventory").container.getItem(player.selectedSlotIndex);
            if (item?.typeId === "bangdream:cassette") {
                system.run(() => {
                    block.setPermutation(block.permutation.withState("bangdream:active", true));
                    showBurnerUI(player, item, player.selectedSlotIndex);
                    system.runTimeout(() => { if (block.isValid()) block.setPermutation(block.permutation.withState("bangdream:active", false)); }, 40);
                });
            } else player.runCommandAsync(`tellraw @s {"rawtext":[{"translate":"walkman.ui.burner_no_cassette"}]}`);
        }
    });
});

// --- [ 刻錄機：檢索與錄製 ] ---
function burnSongs(p, item, slot, type, manual = []) {
    const inv = p.getComponent("minecraft:inventory").container;
    let list = type === "all" ? [] : manual;
    if (type === "all") { for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (it && DISC_MAP[it.typeId]) list.push(it.typeId); } }
    system.run(() => {
        const fresh = inv.getItem(slot);
        if (fresh?.typeId === "bangdream:cassette") {
            fresh.setDynamicProperty("playlist", JSON.stringify(list.slice(0, 60)));
            inv.setItem(slot, fresh);
            p.runCommandAsync(`tellraw @s {"rawtext":[{"translate":"walkman.ui.burner_success","with":["${list.length}"]}]}`);
        }
    });
}

function showBurnerUI(p, item, slot) {
    new ActionFormData().title({ translate: "walkman.ui.burner_title" }).button({ translate: "walkman.ui.burner_all" }).button({ translate: "walkman.ui.burner_manual" }).button({ translate: "walkman.ui.burner_clear" }).show(p).then(res => {
        if (res.selection === 0) burnSongs(p, item, slot, "all");
        else if (res.selection === 1) showSearchAndSelect(p, item, slot, "");
        else if (res.selection === 2) burnSongs(p, item, slot, "clear");
    });
}

function showSearchAndSelect(p, item, slot, filter) {
    const matched = [];
    for (const id in DISC_MAP) {
        const n = DISC_MAP[id].name.toLowerCase(), kw = DISC_MAP[id].keywords || "";
        if (filter === "" || n.includes(filter.toLowerCase()) || id.includes(filter.toLowerCase()) || kw.includes(filter.toLowerCase())) matched.push({ id, name: DISC_MAP[id].name });
    }
    const cur = JSON.parse(item.getDynamicProperty("playlist") || "[]");
    const modal = new ModalFormData().title("§0音軌檢索系統").textField({ translate: "walkman.ui.search_label" }, { translate: "walkman.ui.search_placeholder" }, filter);
    matched.forEach(s => modal.toggle({ translate: s.name }, cur.includes(s.id)));
    modal.submitButton({ translate: "walkman.ui.search_confirm" });
    modal.show(p).then(res => {
        if (res.canceled) return;
        const newF = res.formValues[0], selIds = matched.filter((_, i) => res.formValues[i + 1]).map(s => s.id);
        const others = cur.filter(id => !matched.some(m => m.id === id));
        const final = [...new Set([...others, ...selIds])].slice(0, 60);
        if (newF !== filter) {
            item.setDynamicProperty("playlist", JSON.stringify(final));
            p.getComponent("minecraft:inventory").container.setItem(slot, item);
            showSearchAndSelect(p, item, slot, newF);
        } else burnSongs(p, item, slot, "manual", final);
    });
}

// --- [ 1. 唱片機循環邏輯：穩定 20 Tick 版 ] ---
// 分離循環，解決音符過快與重複播放問題
system.runInterval(() => {
    ACTIVE_JUKEBOXES.forEach((data, key) => {
        try {
            const dim = world.getDimension(data.dimId);
            const listRaw = world.getDynamicProperty(key + "_list");

            // 正常速度噴射粒子 (每秒噴一次)
            dim.spawnParticle("minecraft:note_particle", { x: data.x + 0.5, y: data.y + 1.2, z: data.z + 0.5 });
            ["minecraft:basic_bubble_particle", "minecraft:villager_happy"].forEach(p => dim.spawnParticle(p, { x: data.x + 0.5, y: data.y + 1.2, z: data.z + 0.5 }));

            if (data.timer <= 0) {
                let toPlayId = world.getDynamicProperty(key);
                let info = "";
                if (listRaw && listRaw !== "[]") {
                    const pl = JSON.parse(listRaw);
                    let idx = world.getDynamicProperty(key + "_index") || 0;
                    toPlayId = pl[idx % pl.length];
                    world.setDynamicProperty(key + "_index", (idx + 1) % pl.length);
                    info = `${(idx % pl.length) + 1}/${pl.length}`;
                }
                if (toPlayId) {
                    let sId = DISC_MAP[toPlayId]?.sound || (toPlayId.startsWith("minecraft:music_disc_") ? `record.${toPlayId.replace("minecraft:music_disc_", "")}` : null);
                    let dur = DISC_MAP[toPlayId]?.duration || 180;
                    if (sId) {
                        const oldS = world.getDynamicProperty(key + "_cur_s");
                        if (oldS) dim.runCommand(`stopsound @a ${oldS}`);
                        dim.runCommand(`playsound ${sId} @a ${data.x} ${data.y} ${data.z} 4.0 1.0`);
                        world.setDynamicProperty(key + "_cur_s", sId);
                        data.timer = dur; // 內存計時器鎖定，精確倒數
                        world.setDynamicProperty(key + "_cur_n", DISC_MAP[toPlayId]?.name || `item.${toPlayId}`);
                        world.setDynamicProperty(key + "_info", info);
                        dim.runCommand(`execute positioned ${data.x} ${data.y} ${data.z} run playanimation @e[type=parrot,r=12] animation.parrot.dance dance 10`);
                    }
                }
            } else {
                data.timer -= 1; // 正常的每秒減 1
            }

            // ActionBar 廣播
            const curN = world.getDynamicProperty(key + "_cur_n");
            if (curN) {
                const info = world.getDynamicProperty(key + "_info") || "";
                for (const player of world.getAllPlayers()) {
                    if (Math.abs(player.location.x - data.x) < 12) {
                        const m = info !== "" ? { translate: "walkman.actionbar.jukebox_playlist", with: [info.split('/')[0], info.split('/')[1]] } : { translate: "walkman.actionbar.jukebox_single" };
                        player.onScreenDisplay.setActionBar({ rawtext: [m, { translate: curN }] });
                    }
                }
            }
        } catch (e) { ACTIVE_JUKEBOXES.delete(key); }
    });
}, 20); // 重要：唱片機邏輯每秒只跑一次

// --- [ 2. 隨身聽循環邏輯：高頻 1 Tick 版 ] ---
// 保持隨身聽邏輯不變，確保拖拽保護有效
system.runInterval(() => {
    for (const p of world.getAllPlayers()) {
        try {
            const inv = p.getComponent("minecraft:inventory")?.container;
            if (!inv) continue;
            let hasW = false; let cass = null;
            for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (it?.typeId === "bangdream:walkman") hasW = true; if (it?.typeId === "bangdream:cassette") cass = it; }
            
            const isPl = p.getDynamicProperty("is_playlist") ?? false;
            let t = p.getDynamicProperty("walkman_timer") ?? 0;
            let linger = p.getDynamicProperty("walkman_linger") ?? 0;

            if (hasW) p.setDynamicProperty("walkman_linger", 60);
            else if (linger > 0) { p.setDynamicProperty("walkman_linger", linger - 1); hasW = true; }

            if (hasW && (p.getDynamicProperty("walkman_song") || isPl)) {
                let playingId = p.getDynamicProperty("playing_id"); 
                let pl = []; let idx = p.getDynamicProperty("playlist_index") || 0;

                if (t <= 0) {
                    let toId = p.getDynamicProperty("walkman_song");
                    if (isPl && cass) {
                        pl = JSON.parse(cass.getDynamicProperty("playlist") || "[]");
                        if (pl.length > 0) { toId = pl[idx % pl.length]; p.setDynamicProperty("playlist_index", (idx + 1) % pl.length); }
                    }
                    if (toId) {
                        const s = DISC_MAP[toId], sId = s ? s.sound : `record.${toId.replace("minecraft:music_disc_", "")}`;
                        forceKillSounds(p);
                        p.runCommandAsync(`playsound ${sId}${s ? ".ui" : ""} @s ~ ~ ~ ${(p.getDynamicProperty("walkman_vol") ?? 1).toFixed(1)} 1.0`);
                        p.runCommandAsync(`execute at @s run playsound ${sId} @a[rm=0.1] ~ ~ ~ 0.2 1.0`);
                        p.setDynamicProperty("playing_id", toId); 
                        p.setDynamicProperty("last_s", sId + (s ? ".ui" : ""));
                        p.setDynamicProperty("walkman_timer", (s ? s.duration : 180));
                        playingId = toId;
                    }
                } else if (system.currentTick % 20 === 0) p.setDynamicProperty("walkman_timer", t - 1);

                if (playingId && system.currentTick % 20 === 0) {
                    const s = DISC_MAP[playingId], name = s ? { translate: s.name } : { translate: `item.${playingId}` };
                    const prefix = isPl ? { translate: "walkman.actionbar.playlist", with: [ ( ( (p.getDynamicProperty("playlist_index") || 1) + JSON.parse(cass?.getDynamicProperty("playlist") || "[]").length - 1) % Math.max(1, JSON.parse(cass?.getDynamicProperty("playlist") || "[]").length) + 1).toString(), Math.max(1, JSON.parse(cass?.getDynamicProperty("playlist") || "[]").length).toString()] } : { translate: "walkman.actionbar.playing" };
                    p.onScreenDisplay.setActionBar({ rawtext: [prefix, name] });
                }
            } else if (!hasW && p.getDynamicProperty("playing_id")) stopPlayer(p);
        } catch (err) {}
    }
}, 1);

// --- [其餘工具與監聽] ---
function forceKillSounds(p) { for (const id in DISC_MAP) { p.runCommandAsync(`stopsound @s ${DISC_MAP[id].sound}.ui`); p.runCommandAsync(`stopsound @s ${DISC_MAP[id].sound}`); } }
function stopPlayer(p) { const lastS = p.getDynamicProperty("last_s"); if (lastS) p.runCommandAsync(`stopsound @s ${lastS}`); p.setDynamicProperty("walkman_song", ""); p.setDynamicProperty("is_playlist", false); p.setDynamicProperty("walkman_timer", 0); p.setDynamicProperty("playing_id", ""); p.runCommandAsync(`tellraw @s {"rawtext":[{"translate":"walkman.ui.stopped"}]}`); }

world.afterEvents.playerPlaceBlock.subscribe((e) => { if (e.block.typeId.includes("bangdream:")) { const rot = e.player.getRotation().y; let dir = (rot >= -45 && rot < 45) ? 0 : (rot >= 45 && rot < 135) ? 3 : (rot >= 135 || rot <= -135) ? 1 : 2; system.run(() => { if (e.block.isValid()) e.block.setPermutation(e.block.permutation.withState("bangdream:direction", dir)); }); } });
world.beforeEvents.playerBreakBlock.subscribe((e) => { if (e.block.typeId === "bangdream:jukebox") { const k = getBlockKey(e.dimension.id, e.block.location.x, e.block.location.y, e.block.location.z); system.run(() => stopAndCleanup(e.dimension, e.block.location.x, e.block.location.y, e.block.location.z, k)); } });
world.beforeEvents.itemUse.subscribe((e) => { if (e.itemStack.typeId === "bangdream:walkman") system.run(() => showWalkmanUI(e.source)); });

function showWalkmanUI(p) {
    const inv = p.getComponent("minecraft:inventory").container;
    const discs = []; let hasC = false;
    for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (it?.typeId === "bangdream:cassette") hasC = true; if (it && DISC_MAP[it.typeId] && !discs.find(d => d.typeId === it.typeId)) discs.push({ typeId: it.typeId, name: DISC_MAP[it.typeId].name }); }
    const f = new ActionFormData().title({ translate: "walkman.ui.title" }).button({ translate: "walkman.ui.settings" }).button({ translate: "walkman.ui.stop" });
    if (hasC) f.button("§6▶ Playlist Mode");
    discs.forEach(d => f.button({ translate: d.name }));
    f.show(p).then(res => {
        if (res.selection === 0) showSettingsUI(p);
        else if (res.selection === 1) stopPlayer(p);
        else if (hasC && res.selection === 2) { p.setDynamicProperty("is_playlist", true); p.setDynamicProperty("playlist_index", 0); p.setDynamicProperty("walkman_timer", 0); }
        else { const off = hasC ? 3 : 2; if(res.selection >= off) { const sel = discs[res.selection - off]; p.setDynamicProperty("is_playlist", false); p.setDynamicProperty("walkman_song", sel.typeId); p.setDynamicProperty("walkman_timer", 0); } }
    });
}

function showSettingsUI(p) {
    const vol = p.getDynamicProperty("walkman_vol") ?? 1.0, off = p.getDynamicProperty("walkman_offset") ?? 0;
    new ModalFormData().title({ translate: "walkman.settings.title" }).slider({ translate: "walkman.settings.volume" }, 0, 100, 10, vol * 100).slider({ translate: "walkman.settings.offset" }, -10, 10, 1, off).submitButton({ translate: "walkman.ui.save" }).show(p).then(r => { if (!r.canceled) { p.setDynamicProperty("walkman_vol", r.formValues[0] / 100); p.setDynamicProperty("walkman_offset", r.formValues[1]); } });
}