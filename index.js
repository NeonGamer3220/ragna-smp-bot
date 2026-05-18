const {
  Client, GatewayIntentBits, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  InteractionType, Partials, ModalBuilder,
  TextInputBuilder, TextInputStyle
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

/* ---------- env ---------- */
const GUILD_ID             = process.env.GUILD_ID;
const LOG_CHANNEL_ID       = process.env.LOG_CHANNEL_ID      || '1504913411010461938';
const TEAM_CREATE_CH       = process.env.TEAM_CREATE_CH      || '1505117200522936380';
const TEAM_CREATE_ROLE     = process.env.TEAM_CREATE_ROLE    || '1504866162713039002';
const SUPERADMIN_ROLE      = process.env.SUPERADMIN_ROLE     || '1481717940142215318';
const ADMIN_IDS            = new Set(
  (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);

function isAdmin(interaction) {
  if (ADMIN_IDS.has(String(interaction.user.id))) return true;
  const roles = interaction.member?.roles?.cache;
  return roles ? roles.has(SUPERADMIN_ROLE) : false;
}
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_KEY      = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const DATA_FILE         = path.join(__dirname, 'data.json');

/* ---------- supabase ---------- */
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---------- local fallback store ---------- */
function loadLocal() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { tierlist: {}, teams: {} }; }
}
function saveLocal() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(localStore, null, 2));
}
let localStore = loadLocal();

/* ---------- constants ---------- */
const RANK_ORDER  = ['S', 'A', 'B', 'C', 'D', 'F'];
const RANK_POINTS = { S: 16, A: 10, B: 8, C: 6, D: 4, F: 2 };
const MAX_TEAM    = 28;

const SMP_QUESTIONS = [
  'Mi a minecraft neved?', 'Mi a discord neved?', 'Hány éves vagy?',
  'Milyen céllal jösz a szerverre?', 'Milyen képességeid vannak a minecrafton belül és 10/? mennyire jók?',
  'Van tapasztalatod smpkben?', 'Milyen smpken játszottál már?', 'Mennyi idege játszol minecraftot?',
  'Mennyi időt tudnál aktiv lenni a szerveren?', 'Videós vagy? Ha igen készítenél videót?',
];

const STAFF_QUESTIONS = [
  'Mi a minecraft neved?', 'Mi a discord neved?', 'Hány éves vagy?',
  'Milyen pozícióra jelentkezel?', 'Mióta vagy a Ragna SMP közösségnek a tagja?',
  'Mennyi időt tudsz aktívan a szerverre fordítani?', 'Tisztában vagy-e a szabályokkal és betudod-e azt tartatni?',
  'Mit tennél ha egy másik staff tévedne?', 'Mit gondolsz a gyűlöletbeszédről és toxikus viselkedésről?',
  'Mit tennél, ha nem lennél biztos valamiben?', 'Van e staff tapasztalod, ha igen hol?',
  'Elfogadod, ha egy magasabb rangú staff felülbírál?', 'Miért fontos szerinted, hogy részletesen tudd a szabályzatot?',
  'Miért téged válasszunk?', 'Van valami egyéb dolog amit szeretnél hogy tudjunk rólad?',
];

const apps = Object.create(null);

/* ---------- embed helpers ---------- */
function qEmb(n, t, q)  { return new EmbedBuilder().setColor(0xFF0000).setDescription(`**Kérdés ${n}/${t}**\n${q}`); }
function logEmb(u, type, a) {
  const qs = type === 'smp' ? SMP_QUESTIONS : STAFF_QUESTIONS;
  const cm = { smp: 0x00FF00, staff: 0xFF8C00 };
  const lm = { smp: 'SMP Tag Jelentkezés', staff: 'Staff Jelentkezés' };
  let d = `**Felhasználó:** ${u.tag}\n**Jelentkezés típusa:** ${lm[type]}\n\n`;
  a.forEach((v, i) => { d += `**${i+1}.** ${qs[i]}\n**Válasz:** ${v}\n\n`; });
  return new EmbedBuilder().setColor(cm[type]).setTitle(lm[type]).setDescription(d).setFooter({ text: `${u.tag} • ${u.id}` });
}
function doneDM() {
  return new EmbedBuilder().setColor(0x00FF00).setTitle('Jelentkezés Befejezve')
    .setDescription('A jelentkezésed sikeresen leadva. Várj az adminok értékelésére.');
}
function decisionEmb(tag, msg, ok) {
  return new EmbedBuilder()
    .setColor(ok ? 0x00FF00 : 0xFF0000)
    .setTitle(ok ? '**Ragna SMP Jelentkezés Elfogadva**' : '**Ragna SMP Jelentkezés Elutasítva**')
    .setDescription(`A jelentkezésedet **${tag}** bírálta el.\n\n**Elbíráló üzenete:**\n${msg || '(Nincs üzenet)'}\n\nA jelentkezésed ${ok ? 'elfogadásra' : 'elutasításra'} került.`);
}
function disBtns() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('_x_').setLabel('Elbírálva').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('_x_').setLabel('Elbírálva').setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
}

/* ---------- tierlist (supabase) ---------- */
async function sbTierlist() {
  const { data, error } = await supabase.from('tierlist').select('discord_id, username, mc_name, tier').order('tier');
  if (error) { console.error('sbTierlist:', error.message); return []; }
  return data || [];
}

function tierEmb(rank, rows) {
  const players = (rows || [])
    .filter(r => r.tier === rank)
    .map(r => `- ${r.username} | ${r.mc_name || '-'} [${r.tier}]`)
    .join('\n') || '*Nincs játékos ezen a rangon.*';
  return new EmbedBuilder().setTitle(`Ragna SMP Tierlista — ${rank}`).setColor(0xFF0000).setDescription(players).setTimestamp();
}

async function syncTierlist(channel) {
  const guild = channel.guild;
  if (!guild) return;
  const rows = await sbTierlist();
  if (!rows.length) return;
  // delete tracked
  const tracked = localStore._tlMsgs?.[guild.id] || [];
  for (const mid of tracked) {
    try { const m = await channel.messages.fetch(mid).catch(() => null); if (m) await m.delete().catch(() => {}); } catch {}
  }
  const sent = [];
  for (const r of RANK_ORDER) { sent.push((await channel.send({ embeds: [tierEmb(r, rows)] })).id); }
  localStore._tlMsgs = { ...localStore._tlMsgs, [guild.id]: sent };
  saveLocal();
}

/* ---------- team (supabase) ---------- */
async function sbTeam(name) {
  const { data, error } = await supabase.from('teams').select('*').eq('name', name).single();
  if (error) return null;
  const { data: members } = await supabase.from('team_members').select('*').eq('team_name', name);
  const { data: queue }   = await supabase.from('team_queue').select('*').eq('team_name', name);
  return { ...data, members: (members || []).map(m => m.player_id), queue: (queue || []).map(q => ({ discordId: q.player_id, mcName: q.mc_name })), mcNames: Object.fromEntries((members || []).map(m => [m.player_id, m.mc_name || ''])) };
}

async function sbTeamPoints(team) {
  const { data: rows } = await supabase.from('tierlist').select('tier').in('discord_id', team.members);
  return (rows || []).reduce((p, r) => p + (RANK_POINTS[r.tier] || 0), 0);
}

async function teamEmb(name) {
  const team = await sbTeam(name);
  if (!team) return null;
  const pts  = await sbTeamPoints(team);
  const rows = await sbTierlist();
  const byRank = Object.fromEntries(RANK_ORDER.map(r => [r, []]));
  for (const m of team.members) {
    const tier = rows.find(r => r.discord_id === m);
    if (tier) byRank[tier.tier].push(m);
  }
  const rankRows = RANK_ORDER.map(r => `**${r}** — ${byRank[r].length} játékos (${byRank[r].length * (RANK_POINTS[r] || 0)} pont)`);
  const memberLines = await Promise.all(team.members.map(async uid => {
    const u = await client.users.fetch(uid).catch(() => null);
    const tier = rows.find(r => r.discord_id === uid);
    const tag = u ? u.tag : uid;
    const mc  = team.mcNames[uid] || tier?.mc_name || '-';
    const rk  = tier?.tier || '?';
    return `${tag} | ${mc} [${rk}]`;
  }));
  return new EmbedBuilder()
    .setTitle(`⚔️ ${name}`)
    .setColor(0xFF4500)
    .setDescription(`**Összes pont:** ${pts} / ${MAX_TEAM}\n${rankRows.join('\n')}\n\n**Tagok:**\n${memberLines.join('\n') || '*Nincs tag még.*'}`)
    .setFooter({ text: `Vezető: ${(await client.users.fetch(team.leaderId).catch(() => ({ tag: team.leaderId }))).tag}` });
}

/* ---------- application flow ---------- */
async function startApp(dm, userId, type) {
  const qs = type === 'smp' ? SMP_QUESTIONS : STAFF_QUESTIONS;
  const t  = qs.length;
  apps[userId] = { type, answers: [], awaitingInput: true };
  await dm.send({ embeds: [new EmbedBuilder().setColor(0xFF0000).setDescription(`**Jelentkezés elkezdve!**\nSorban ${t} kérdést kapsz.`)] });
  await dm.send({ embeds: [qEmb(1, t, qs[0])] });
}

async function finishApp(user, type, answers) {
  await user.send({ embeds: [doneDM()] }).catch(() => {});
  const ch = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (ch) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ap_${user.id}`).setLabel('Elfogadás').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ar_${user.id}`).setLabel('Elutasítás').setStyle(ButtonStyle.Danger),
    );
    await ch.send({ embeds: [logEmb(user, type, answers)], components: [row] }).catch(console.error);
  }
}

/* ---------- button handler ---------- */
async function handleBtn(interaction) {
  const c = interaction.customId;

  if (c === '_x_') { await interaction.deferUpdate(); return; }

  /* ── TGFPanel ── */
   if (c === 'apply_smp' || c === 'apply_staff') {
    const type = c === 'apply_smp' ? 'smp' : 'staff';
    try {
      const dm = await interaction.user.createDM();
      await interaction.reply({ content: 'DM csatorna megnyitva!', ephemeral: true });
      await startApp(dm, interaction.user.id, type);
    } catch { await interaction.reply({ content: 'Nem sikerült megnyitni a DM-et.', ephemeral: true }); }
    return;
  }


  /* ── Team join ── */
  if (c.startsWith('tj_')) {
    const name = c.slice(3);
    const uid  = String(interaction.user.id);
    if (Object.values(await supabase.from('teams').select('leader_id, team_members(player_id)').then(r => r.data?.flatMap(t => [t.leader_id, ...(t.team_members?.map(m => m.player_id) || [])]) || [])).some(id => id === uid)) {
      await interaction.reply({ content: 'Már egy másik csapatban vagy!', ephemeral: true }); return;
    }
    const { data: tierRow } = await supabase.from('tierlist').select('tier').eq('discord_id', uid).single();
    if (!tierRow) { await interaction.reply({ content: 'Először szerezned kell egy rangot a tierlistán!', ephemeral: true }); return; }

    const modal = new ModalBuilder().setCustomId(`joinm_${uid}_${name}`)
      .setTitle(`Belépés: ${name}`)
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('mc').setLabel('Minecraft Felhasználónév').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Pl. notch'),
      ));
    await interaction.showModal(modal);
    return;
  }

  /* ── Team leave ── */
  if (c.startsWith('tl_')) {
    const name = c.slice(3);
    const uid  = String(interaction.user.id);
    const { data: team } = await supabase.from('teams').select('*').eq('name', name).single();
    if (!team) { await interaction.reply({ content: 'Nem létező csapat.', ephemeral: true }); return; }
    if (uid === team.leader_id) { await interaction.reply({ content: 'A vezető nem léphet ki! Használd /teamdelete.', ephemeral: true }); return; }

    await supabase.from('team_members').delete().eq('team_name', name).eq('player_id', uid);
    await interaction.followUp({ embeds: [(await teamEmb(name))] }).catch(() => {});
    await interaction.reply({ content: `Kiléptél a **${name}** csapatból.`, ephemeral: true }).catch(() => {});
    return;
  }

  /* ── Queue: accept ── */
  if (c.startsWith('qa_')) {
    const name  = c.slice(3);
    const { data: team } = await supabase.from('teams').select('*').eq('name', name).single();
    if (!team) return;
    if (String(interaction.user.id) !== team.leader_id && !isAdmin(interaction)) {
      await interaction.reply({ content: 'Csak a vezető vagy admin csinálhatja!', ephemeral: true }); return;
    }
    const { data: qEntry } = await supabase.from('team_queue').select('*').eq('team_name', name).order('requested_at', { ascending: true }).limit(1).maybeSingle();
    if (!qEntry) { await interaction.reply({ content: 'Nincs kiálló jelentkezés.', ephemeral: true }); return; }

    await supabase.from('team_queue').delete().eq('id', qEntry.id);
    await supabase.from('team_members').insert({ team_name: name, player_id: qEntry.player_id, mc_name: qEntry.mc_name }).then(() => {
      const upd = supabase.from('tierlist').update({ mc_name: qEntry.mc_name }).eq('discord_id', qEntry.player_id);
    });

    await interaction.reply({ content: `✅ **${qEntry.mc_name}** hozzáadva a **${name}** csapathoz!`, ephemeral: false }).catch(() => {});
    return;
  }

  /* ── Queue: reject ── */
  if (c.startsWith('qr_')) {
    const name = c.slice(3);
    const { data: team } = await supabase.from('teams').select('*').eq('name', name).single();
    if (!team) return;
    if (String(interaction.user.id) !== team.leader_id && !isAdmin(interaction)) {
      await interaction.reply({ content: 'Csak a vezető vagy admin csinálhatja!', ephemeral: true }); return;
    }
    const { data: qEntry } = await supabase.from('team_queue').select('id').eq('team_name', name).order('requested_at', { ascending: true }).limit(1).maybeSingle();
    if (!qEntry) { await interaction.reply({ content: 'Nincs kiálló jelentkezés.', ephemeral: true }); return; }

    await supabase.from('team_queue').delete().eq('id', qEntry.id);
    await interaction.reply({ content: '❌ Jelentkezés elutasítva.', ephemeral: false }).catch(() => {});
    return;
  }

  /* ── Tournament: generate matches ── */
  if (c.startsWith('tmatch_')) {
    const rest   = c.slice(7);
    const idx    = rest.lastIndexOf('_');
    const tName  = rest.substring(0, idx);
    const round  = parseInt(rest.substring(idx + 1), 10);

    const { data: players } = await supabase.from('tournament_players').select('player_id').eq('tournament_name', tName).eq('eliminated', false);
    if (!players?.length) { await interaction.reply({ content: 'Nincs játékos a versenyben!', ephemeral: true }); return; }

    // Shuffle & pair
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const matches  = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      matches.push({
        tournament_name: tName,
        round_num:       round,
        player1_id:      shuffled[i].player_id,
        player2_id:      shuffled[i + 1]?.player_id || null,
      });
    }
    await supabase.from('tournament_matches').insert(matches);

    // Disable the generating button
    await interaction.message.edit({ components: [disBtns()] }).catch(() => {});

    // Send match table as follow-up message
    const lines = matches.map(m => {
      const tag1 = `<@${m.player1_id}>`;
      const tag2 = m.player2_id ? `<@${m.player2_id}>` : '*(bye)*';
      return `**M${matches.indexOf(m)+1}.** ${tag1} vs ${tag2}`;
    });

    // Send winner buttons — one row per match
    const btnRows = matches.map(m => new ActionRowBuilder().addComponents(
      ...(m.player2_id
        ? [
            new ButtonBuilder().setCustomId(`tw_${m.id}_${m.player1_id}`).setLabel(`✅ <@${m.player1_id}> nyer?`).setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`tw_${m.id}_${m.player2_id}`).setLabel(`✅ <@${m.player2_id}> nyer?`).setStyle(ButtonStyle.Success),
          ]
        : [
            new ButtonBuilder().setCustomId(`tw_${m.id}_${m.player1_id}`).setLabel(`🏆 <@${m.player1_id}> (bye)`).setStyle(ButtonStyle.Primary),
          ]
      ),
    ));

    await interaction.followUp({
      embeds: [new EmbedBuilder().setColor(0xFF4500).setTitle(`${tName} — ${round}. kör`).setDescription(lines.join('\n'))],
      components: btnRows,
    }).catch(console.error);
    return;
  }

  /* ── Tournament: record winner ── */
  if (c.startsWith('tw_')) {
    // tw_<matchId>_<winnerDiscordId>
    const parts   = c.split('_');
    const matchId = parseInt(parts[1], 10);
    const winnerId  = c.slice(parts[1].length + 3); // everything after "tw_<matchId>_"

     const { data: match } = await supabase.from('tournament_matches').select('*').eq('id', matchId).single();
    if (!match) { await interaction.reply({ content: 'Pár nem található.', ephemeral: true }); return; }
    if (match.winner_id) {
      await interaction.reply({ content: 'Ez a mérkőzés már döntetlen!', ephemeral: true }); return;
    }

    const tName = match.tournament_name;
    const round = match.round_num;
    const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;

    // Record winner
    const { error: wErr } = await supabase.from('tournament_matches')
      .update({ winner_id: winnerId, played_at: new Date() }).eq('id', matchId);
    if (wErr) { console.error('Winner update:', wErr.message); }

    // Eliminate loser
    if (loserId) {
      await supabase.from('tournament_players').update({
        eliminated: true, eliminated_in_round: round, eliminated_at: new Date(),
      }).eq('tournament_name', tName).eq('player_id', loserId);
    }

    await interaction.reply({ content: `✅ <@${winnerId}> nyert ezt a mérkőzést! (${tName} – ${round}. kör)` }).catch(() => {});

    // Check if round is fully played
    const { data: allMatches } = await supabase.from('tournament_matches')
      .select('winner_id').eq('tournament_name', tName).eq('round_num', round);
    const allDone = (allMatches || []).every(m => !!m.winner_id);
    if (!allDone) return;

    await supabase.from('tournament_rounds')
      .update({ status: 'done', ended_at: new Date() })
      .eq('tournament_name', tName).eq('round_num', round);

    const { data: alive } = await supabase.from('tournament_players')
      .select('player_id').eq('tournament_name', tName).eq('eliminated', false);

    if (alive?.length === 1) {
      // ── GYŐZTES ──
      const winId = alive[0].player_id;
      await supabase.from('tournaments')
        .update({ status: 'finished', winner_id: winId, ended_at: new Date() }).eq('name', tName);

      const winUser = await client.users.fetch(winId).catch(() => ({ tag: winId }));
      const { data: elims } = await supabase.from('tournament_players')
        .select('player_id, eliminated_in_round').eq('tournament_name', tName).eq('eliminated', true);

      const elimLines = (elims || []).map(e => {
        const u = client.users.cache.get(e.player_id);
        return `${u?.tag || e.player_id} — ${e.eliminated_in_round}. körben esett ki`;
      }).join('\n') || '*Senki sem esett ki (csak 1 játékos volt).*';

      await interaction.channel.send({ embeds: [new EmbedBuilder()
        .setColor(0xFFD700)
        .setTitle(`🏆 ${tName} — Győztes: ${winUser.tag}!`)
        .setDescription(`**${winUser.tag}** nyert a **${tName}** tornán!\n\n**Kiesések:**\n${elimLines}`)] });
    } else if (alive?.length > 1) {
      // ── Next round ──
      const nr = round + 1;
      await supabase.from('tournament_rounds').insert({ tournament_name: tName, round_num: nr, status: 'pending' });
      await supabase.from('tournaments').update({ current_round: nr }).eq('name', tName);
      await interaction.channel.send({ embeds: [new EmbedBuilder().setColor(0x00FF00)
        .setTitle(`${tName}`)
        .setDescription(`A **${nr}. kör** hamarosan!`)] });
    }
    return;
  }

  /* ── Review buttons (same as before) ── */
  if (c.startsWith('ap_')) {
    const uid = c.slice(3);
    const modal = new ModalBuilder().setCustomId(`apm_${uid}`)
      .setTitle('Jelentkezés elfogadása')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('msg').setLabel('Üzenet (opcionális)').setStyle(TextInputStyle.Paragraph).setRequired(false),
      ));
    await interaction.showModal(modal); return;
  }
  if (c.startsWith('ar_')) {
    const uid = c.slice(3);
    const modal = new ModalBuilder().setCustomId(`arm_${uid}`)
      .setTitle('Jelentkezés elutasítása')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('Elutasítás indoklása').setStyle(TextInputStyle.Paragraph).setRequired(true),
      ));
    await interaction.showModal(modal); return;
  }
}

/* ---------- modal handler ---------- */
async function decision(uId, tag, msg, ok) {
  const u = await client.users.fetch(uId).catch(() => null);
  if (u) try { await u.send({ embeds: [decisionEmb(tag, msg, ok)] }); } catch {}
}

async function handleModal(interaction) {
  const c = interaction.customId;

  if (c.startsWith('apm_')) {
    const uid = c.slice(4), msg = interaction.fields.getTextInputValue('msg') || '';
    await decision(uid, interaction.user.tag, msg, true);
    try { await interaction.message.edit({ components: [disBtns()] }); } catch {}
    await interaction.reply({ content: 'Elfogadva.', ephemeral: true }).catch(() => {});
    return;
  }
  if (c.startsWith('arm_')) {
    const uid = c.slice(4), reason = interaction.fields.getTextInputValue('reason');
    await decision(uid, interaction.user.tag, reason, false);
    try { await interaction.message.edit({ components: [disBtns()] }); } catch {}
    await interaction.reply({ content: 'Elutasítva.', ephemeral: true }).catch(() => {});
    return;
  }
  /* Team join modal */
  if (c.startsWith('joinm_')) {
    const parts = c.split('_');
    const uid   = parts[1];
    const tName = c.slice(c.lastIndexOf('_') + 1);
    const mc    = interaction.fields.getTextInputValue('mc').trim();

    const { data: existing } = await supabase.from('team_members').select('player_id').eq('team_name', tName).eq('player_id', uid).maybeSingle();
    if (existing) { await interaction.reply({ content: 'Már a csapat tagja vagy!', ephemeral: true }); return; }

    await supabase.from('team_queue').insert({ team_name: tName, player_id: uid, mc_name: mc });
    await interaction.reply({ content: `Jelentkezésed elküldve a **${tName}** vezetőjének!`, ephemeral: true }).catch(() => {});
    return;
  }
}

/* ---------- DM ---------- */
async function handleDM(msg) {
  const app = apps[msg.author.id];
  if (!app || !app.awaitingInput) return;

  app.answers.push(msg.content);
  const qs = app.type === 'smp' ? SMP_QUESTIONS : STAFF_QUESTIONS;
  if (app.answers.length >= qs.length) {
    app.awaitingInput = false;
    await finishApp(msg.author, app.type, app.answers);
    return;
  }
  const n = app.answers.length + 1;
  await msg.author.send({ embeds: [qEmb(n, qs.length, qs[n-1])] }).catch(console.error);
}

/* ---------- commands ---------- */
const CMDS = [
  new SlashCommandBuilder().setName('tgfpanel').setDescription('Jelentkezési panel').setDMPermission(false),

  new SlashCommandBuilder().setName('tierlistadd')
    .setDescription('Játékos hozzáadása a tierlistához')
    .addUserOption(o => o.setName('user').setDescription('Discord felhasználó').setRequired(true))
    .addStringOption(o => o.setName('mcname').setDescription('Minecraft felhasználónév').setRequired(true))
    .addStringOption(o => o.setName('rank').setDescription('Rang').setRequired(true)
      .addChoices({ name:'S',value:'S' },{ name:'A',value:'A' },{ name:'B',value:'B' },{ name:'C',value:'C' },{ name:'D',value:'D' },{ name:'F',value:'F' })),

  new SlashCommandBuilder().setName('tierlist').setDescription('Tierlista').addStringOption(o => o.setName('rank').setDescription('Rang').setRequired(false)
    .addChoices({ name:'S',value:'S' },{ name:'A',value:'A' },{ name:'B',value:'B' },{ name:'C',value:'C' },{ name:'D',value:'D' },{ name:'F',value:'F' })),

  new SlashCommandBuilder().setName('teamcreate').setDescription('Új csapat létrehozása').addStringOption(o => o.setName('name').setDescription('Csapat neve').setRequired(true)),
  new SlashCommandBuilder().setName('teamdelete').setDescription('Csapat törlése (admin)').addStringOption(o => o.setName('name').setDescription('Csapat neve').setRequired(true)),
  new SlashCommandBuilder().setName('teamleader')
    .setDescription('Vezető váltása (admin)')
    .addStringOption(o => o.setName('name').setDescription('Csapat neve').setRequired(true))
    .addUserOption(o => o.setName('user').setDescription('Új vezető').setRequired(true)),

  new SlashCommandBuilder().setName('sendtgf')
    .setDescription('Jelentkezési kérdések elküldése egy játékosnak (admin)')
    .addUserOption(o => o.setName('user').setDescription('Játékos Discord felhasználó').setRequired(true))
    .addStringOption(o => o.setName('type').setDescription('Jelentkezés típusa').setRequired(true)
      .addChoices({ name:'SMP Tag',value:'smp' }, { name:'Staff',value:'staff' })),

  /* ─── Tournament ─── */
  new SlashCommandBuilder().setName('tournament').setDescription('Tournament kezelés')
    .addSubcommand(sc => sc.setName('create').setDescription('Új tournament létrehozása (admin)')
      .addStringOption(o => o.setName('name').setDescription('Tournament neve').setRequired(true)))
    .addSubcommand(sc => sc.setName('add').setDescription('Játékos hozzáadása (admin)')
      .addStringOption(o => o.setName('name').setDescription('Tournament neve').setRequired(true))
      .addUserOption(o => o.setName('player').setDescription('Játékos').setRequired(true)))
    .addSubcommand(sc => sc.setName('eliminate').setDescription('Játékos kizárása (admin)')
      .addStringOption(o => o.setName('name').setDescription('Tournament neve').setRequired(true))
      .addUserOption(o => o.setName('player').setDescription('Játékos').setRequired(true)))
    .addSubcommand(sc => sc.setName('players').setDescription('Játékosok listája')
      .addStringOption(o => o.setName('name').setDescription('Tournament neve').setRequired(true)))
    .addSubcommand(sc => sc.setName('start').setDescription('1. kör indítása (admin)')
      .addStringOption(o => o.setName('name').setDescription('Tournament neve').setRequired(true)))
    .addSubcommand(sc => sc.setName('message').setDescription('Üzenet küldése a csatornára (admin)')
      .addStringOption(o => o.setName('text').setDescription('Üzenet szövege').setRequired(true)))
    .addSubcommand(sc => sc.setName('round').setDescription('Kör indítás/lezárása (admin)')
      .addStringOption(o => o.setName('name').setDescription('Tournament neve').setRequired(true))
      .addIntegerOption(o => o.setName('round').setDescription('Kör száma').setRequired(true))
      .addStringOption(o => o.setName('action').setDescription('start/stop').setRequired(true)
        .addChoices({ name:'start',value:'start' }, { name:'stop',value:'stop' }))),
];

async function regCmds() {
  if (GUILD_ID) {
    const g = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (g) { for (const cmd of CMDS) await g.commands.create(cmd).catch(console.error); console.log(`→ guild "${g.name}"`); return; }
  }
  for (const cmd of CMDS) await client.application.commands.create(cmd).catch(console.error);
  console.log('→ global');
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await regCmds();
});

/* ---------- interaction router ---------- */
client.on('interactionCreate', async interaction => {
  try {
    if (interaction.type === InteractionType.ApplicationCommand) {
      const n = interaction.commandName;

      /* TGFPanel */
      if (n === 'tgfpanel') {
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setTitle('Jelentkezés')
          .setDescription('**Jelentkezés**\n\nVálaszd ki, melyik pozícióra szeretnél jelentkezni.\n\n**Fontos tudnivalók:**\n1. 30 naponta egyszer.\n2. Privát üzenetben kell kitöltened.\n3. 60 perc limit.\n4. Sorban kapsz a kérdéseket, visszalépni nem lehet.\n5. A Crystal Management fogja átnézni.')],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('apply_smp').setLabel('SMP Tag').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('apply_staff').setLabel('Staff').setStyle(ButtonStyle.Primary),
          )] });
        return;
      }

      /* SendTGF — admin: trigger application flow for another player */
      if (n === 'sendtgf') {
        if (!isAdmin(interaction)) { await interaction.reply({ content: 'Admin jog!', ephemeral: true }); return; }
        const tUser  = interaction.options.getUser('user');
        const type   = interaction.options.getString('type');
        if (!tUser || !type) { await interaction.reply({ content: 'Adj meg egy usert és típust (SMP Tag / Staff)!', ephemeral: true }); return; }
        const dm = await tUser.createDM().catch(() => null);
        if (!dm) { await interaction.reply({ content: 'Nem sikerült megnyitni a DM-et a játékosnak!', ephemeral: true }); return; }
        await startApp(dm, tUser.id, type);
        await interaction.reply({ content: `✅ Kérdések elküldve **${tUser.tag}** DM-jéba (**${type === 'smp' ? 'SMP Tag' : 'Staff'}** folyamat).` });
        return;
      }

      /* Tierlist */
      if (n === 'tierlist') {
        const rank = interaction.options.getString('rank');
        if (rank) { await interaction.reply({ embeds: [tierEmb(rank, await sbTierlist())] }); return; }
        await interaction.deferReply();
        await syncTierlist(interaction.channel);
        await interaction.followUp('✅ Tierlista elküldve!');
        return;
      }

      /* Tierlistadd */
      if (n === 'tierlistadd') {
        const uObj   = interaction.options.getUser('user');
        const mcName = (interaction.options.getString('mcname') || '').trim();
        const rank   = interaction.options.getString('rank');
        if (!uObj || !mcName || !RANK_ORDER.includes(rank)) {
          await interaction.reply({ content: 'Adj meg Discord usert, MC nevet és rangot!', ephemeral: true }); return;
        }
        await supabase.from('tierlist').upsert({ discord_id: uObj.id, username: uObj.tag, mc_name: mcName, tier: rank }, { onConflict: ['discord_id'] });
        const ch = interaction.channel;
        if (ch) await syncTierlist(ch).catch(console.error);

        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00FF00)
          .setTitle('Rang hozzáadva')
          .setDescription(`**${uObj.tag}** → **${rank}**\nMC: **${mcName}**`)] });
        return;
      }

      /* Teamcreate */
      if (n === 'teamcreate') {
        const name = interaction.options.getString('name');
        if (interaction.channelId !== TEAM_CREATE_CH) { await interaction.reply({ content: 'Csak a csapat-készítő csatornában!', ephemeral: true }); return; }
        if (!interaction.member?.roles?.cache?.has(TEAM_CREATE_ROLE)) { await interaction.reply({ content: 'Nincs jogod!', ephemeral: true }); return; }

        const { data: existing } = await supabase.from('teams').select('name').eq('name', name).maybeSingle();
        if (existing) { await interaction.reply({ content: 'Már létezik ez a csapatnév!', ephemeral: true }); return; }

        const tier = await supabase.from('tierlist').select('mc_name').eq('discord_id', interaction.user.id).single();
        await supabase.from('teams').insert({ name, leader_id: interaction.user.id });
        if (tier.data) await supabase.from('team_members').insert({ team_name: name, player_id: interaction.user.id, mc_name: tier.data.mc_name });

        const embed = await teamEmb(name);
        if (!embed) { await interaction.reply({ content: 'Hiba a csapat embedjét.', ephemeral: true }); return; }
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`tj_${name}`).setLabel('Belépés').setStyle(ButtonStyle.Success).setEmoji('➕'),
          new ButtonBuilder().setCustomId(`tl_${name}`).setLabel('Kilépés').setStyle(ButtonStyle.Danger).setEmoji('➖'),
        );
        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ **${name}** csapat létrehozva!`, ephemeral: false });
        return;
      }

      /* Teamdelete */
      if (n === 'teamdelete') {
        if (!isAdmin(interaction)) { await interaction.reply({ content: 'Admin jog!', ephemeral: true }); return; }
        const name = interaction.options.getString('name');
        const { data: team } = await supabase.from('teams').select('*').eq('name', name).single();
        if (!team) { await interaction.reply({ content: 'Nem létezik.', ephemeral: true }); return; }
        const pts = await sbTeamPoints(team);
        await supabase.from('teams').delete().eq('name', name);
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setTitle('Törölve')
          .setDescription(`**${name}** törölve. Volt pont: **${pts}** / ${MAX_TEAM}`)] });
        return;
      }

      /* Teamleader */
      if (n === 'teamleader') {
        if (!isAdmin(interaction)) { await interaction.reply({ content: 'Admin jog!', ephemeral: true }); return; }
        const name = interaction.options.getString('name');
        const user = interaction.options.getUser('user');
        const { data: team } = await supabase.from('teams').select('*').eq('name', name).single();
        if (!team || !user) { await interaction.reply({ content: 'Hibás adat!', ephemeral: true }); return; }
        await supabase.from('teams').update({ leader_id: user.id }).eq('name', name);
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF8C00)
          .setTitle('Vezető váltás')
          .setDescription(`**${name}** vezetője mostantól **${user.tag}**`)] });
        return;
      }

      /* ─── Tournament ─── */
      if (n === 'tournament') {
        const sub = interaction.options.getSubcommand();

        if (sub === 'create') {
          if (!isAdmin(interaction)) { await interaction.reply({ content: 'Admin jog!', ephemeral: true }); return; }
          const tName = interaction.options.getString('name');
          const { data: existing } = await supabase.from('tournaments').select('name').eq('name', tName).maybeSingle();
          if (existing) { await interaction.reply({ content: 'Már létezik ilyen nevű tournament!', ephemeral: true }); return; }
          await supabase.from('tournaments').insert({ name: tName, created_by: interaction.user.id, status: 'setup' })
            .then(() => supabase.from('tournament_rounds').insert({ tournament_name: tName, round_num: 1, status: 'pending' }));
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setTitle('Tournament létrehozva').setDescription(`**${tName}** létrehozva. Használd /tournament add a játékosok hozzáadásához.`)] });
          return;
        }

        if (sub === 'add') {
          if (!isAdmin(interaction)) { await interaction.reply({ content: 'Admin jog!', ephemeral: true }); return; }
          const tName   = interaction.options.getString('name');
          const pUser   = interaction.options.getUser('player');
          const { data: tourn } = await supabase.from('tournaments').select('*').eq('name', tName).single();
          if (!tourn) { await interaction.reply({ content: 'Nem létezik a tournament.', ephemeral: true }); return; }

          await supabase.from('tournament_players').upsert({ tournament_name: tName, player_id: pUser.id, eliminated: false }, { onConflict: ['tournament_name', 'player_id'] });
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00FF00).setTitle('Játékos hozzáadva')
            .setDescription(`**${pUser.tag}** hozzáadva a **${tName}** tornához.`)] });
          return;
        }

        if (sub === 'eliminate') {
          if (!isAdmin(interaction)) { await interaction.reply({ content: 'Admin jog!', ephemeral: true }); return; }
          const tName = interaction.options.getString('name');
          const pUser  = interaction.options.getUser('player');
          const { data: tourn } = await supabase.from('tournaments').select('*').eq('name', tName).single();
          if (!tourn) { await interaction.reply({ content: 'Nem létezik a tournament.', ephemeral: true }); return; }

          await supabase.from('tournament_players').update({ eliminated: true, eliminated_in_round: tourn.current_round, eliminated_at: new Date() }).eq('tournament_name', tName).eq('player_id', pUser.id);
          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000).setTitle('Kizárva')
            .setDescription(`**${pUser.tag}** kizárva a **${tName}** tornából a **${tourn.current_round}. körben**.`)] });
          return;
        }

        if (sub === 'players') {
          const tName = interaction.options.getString('name');
          const { data: tourn } = await supabase.from('tournaments').select('*').eq('name', tName).single();
          if (!tourn) { await interaction.reply({ content: 'Nem létezik a tournament.', ephemeral: true }); return; }

          const { data: players } = await supabase.from('tournament_players')
            .select('player_id, eliminated, eliminated_in_round')
            .eq('tournament_name', tName)
            .order('eliminated', { ascending: true });

          if (!players?.length) { await interaction.reply({ content: 'Nincs játékos a tornában.', ephemeral: true }); return; }

          const alive  = players.filter(p => !p.eliminated);
          const elim   = players.filter(p => p.eliminated);
          const lines  = [];

          if (alive.length) {
            lines.push('**Élben maradt játékosok:**');
            for (const p of alive) {
              const u = await client.users.fetch(p.player_id).catch(() => ({ tag: p.player_id }));
              lines.push(`${u.tag}`);
            }
          }
          if (elim.length) {
            lines.push('\n**Kiesett játékosok:**');
            for (const p of elim) {
              const u = await client.users.fetch(p.player_id).catch(() => ({ tag: p.player_id }));
              lines.push(`${u.tag} — ${p.eliminated_in_round}. körben esett ki`);
            }
          }

          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF4500)
            .setTitle(`${tName} — ${players.length} játékos`)
            .setDescription(lines.join('\n'))] });
          return;
        }

        if (sub === 'start') {
          if (!isAdmin(interaction)) { await interaction.reply({ content: 'Admin jog!', ephemeral: true }); return; }
          const tName  = interaction.options.getString('name');
          const { data: tourn } = await supabase.from('tournaments').select('current_round').eq('name', tName).single();
          if (!tourn) { await interaction.reply({ content: 'Nem létezik.', ephemeral: true }); return; }
          const round  = tourn.current_round;
          const { data: pRows } = await supabase.from('tournament_players').select('player_id').eq('tournament_name', tName).eq('eliminated', false);
          if (!pRows?.length) { await interaction.reply({ content: 'Nincs élő játékos a tornában.', ephemeral: true }); return; }

          let shuffled = [...pRows].sort(() => Math.random() - 0.5);
          let byeId = null;
          let autoAdvanceText = '';

          if (shuffled.length % 2 === 1) {
            byeId = shuffled.splice(Math.floor(Math.random() * shuffled.length), 1)[0].player_id;
            autoAdvanceText = `Automatikusan továbbjutó: <@${byeId}>`;
          }

          const matches  = [];
          const matches1 = [];
          const matchRows = [];

          for (let i = 0; i < shuffled.length; i += 2) {
            const p1 = shuffled[i].player_id;
            const p2 = shuffled[i + 1]?.player_id ?? 'BYE';
            const m  = { tournament_name: tName, round_num: round, player1_id: p1, player2_id: p2 };
            matches.push(`${p1 === 'BYE' ? '*(bye)*' : `<@${p1}>`} vs ${p2 === 'BYE' ? '*(bye)*' : `<@${p2}>`}`);
            matches1.push(p1 === 'BYE' ? '*(bye)*' : `<@${p1}>`);
            matchRows.push(m);
          }

          await supabase.from('tournament_matches').insert(matchRows);

          if (byeId) {
            const { data: lastMatch } = await supabase.from('tournament_matches').select('id').eq('tournament_name', tName).eq('round_num', round).eq('player1_id', byeId).single();
            if (lastMatch) await supabase.from('tournament_matches').update({ winner_id: byeId, played_at: new Date() }).eq('id', lastMatch.id);
          }

          const matchCount    = matches.length;
          const totalMatches  = matchCount;
          const allLines      = [...matches1, ...matches];
          const descLines     = [
            `**Összes játékos: ${pRows.length}**`,
            `**Meccsek száma: ${totalMatches}**`,
            `${autoAdvanceText ? `**Automatikusan továbbjutó:** ${autoAdvanceText}` : ''}`,
            `**Meccsek:**`,
            ...matches.map(l => l),
            '',
            '**Ajánlott szerver:** eu.minemen.club',
            'Sok sikert kívánunk mindenkinek!',
          ].filter(Boolean);

          await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00FF00)
            .setTitle(`**${tName}** Tournament ${round}. Köre Elkezdődött!`)
            .setDescription(descLines.join('\n'))] });
          return;
        }

        if (sub === 'round') {
          if (!isAdmin(interaction)) { await interaction.reply({ content: 'Admin jog!', ephemeral: true }); return; }
          const tName = interaction.options.getString('name');
          const round = interaction.options.getInteger('round');
          const act   = interaction.options.getString('action');

          const { data: tourn } = await supabase.from('tournaments').select('*').eq('name', tName).single();
          if (!tourn) { await interaction.reply({ content: 'Nem létezik.', ephemeral: true }); return; }

          if (act === 'start') {
            const { data: pRows } = await supabase.from('tournament_players').select('player_id').eq('tournament_name', tName).eq('eliminated', false);
            if (!pRows?.length) { await interaction.reply({ content: 'Nincs élő játékos a tornában.', ephemeral: true }); return; }

            let shuffled = [...pRows].sort(() => Math.random() - 0.5);
            let byeId = null;
            let autoAdvanceText = '';

            if (shuffled.length % 2 === 1) {
              byeId = shuffled.splice(Math.floor(Math.random() * shuffled.length), 1)[0].player_id;
              autoAdvanceText = `Automatikusan továbbjutó: <@${byeId}>`;
            }

            const matches  = [];
            const matches1 = [];
            const matchRows = [];

            for (let i = 0; i < shuffled.length; i += 2) {
              const p1 = shuffled[i].player_id;
              const p2 = shuffled[i + 1]?.player_id ?? 'BYE';
              const m  = { tournament_name: tName, round_num: round, player1_id: p1, player2_id: p2 };
              matches.push(`${p1 === 'BYE' ? '*(bye)*' : `<@${p1}>`} vs ${p2 === 'BYE' ? '*(bye)*' : `<@${p2}>`}`);
              matches1.push(p1 === 'BYE' ? '*(bye)*' : `<@${p1}>`);
              matchRows.push(m);
            }

            await supabase.from('tournament_matches').insert(matchRows);
            await supabase.from('tournament_rounds').update({ status: 'active', started_at: new Date() }).eq('tournament_name', tName).eq('round_num', round);

            if (byeId) {
              const { data: lastMatch } = await supabase.from('tournament_matches').select('id').eq('tournament_name', tName).eq('round_num', round).eq('player1_id', byeId).single();
              if (lastMatch) await supabase.from('tournament_matches').update({ winner_id: byeId, played_at: new Date() }).eq('id', lastMatch.id);
            }

            const matchCount    = matches.length;
            const totalMatches  = matchCount;
            const allLines      = [...matches1, ...matches];
            const descLines     = [
              `**Összes játékos: ${pRows.length}**`,
              `**Meccsek száma: ${totalMatches}**`,
              `${autoAdvanceText ? `**Automatikusan továbbjutó:** ${autoAdvanceText}` : ''}`,
              `**Meccsek:**`,
              ...matches.map(l => l),
              '',
              '**Ajánlott szerver:** eu.minemen.club',
              'Sok sikert kívánunk mindenkinek!',
            ].filter(Boolean);

            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00FF00)
              .setTitle(`**${tName}** Tournament ${round}. Köre Elkezdődött!`)
              .setDescription(descLines.join('\n'))] });
          } else {
            await supabase.from('tournament_rounds').update({ status: 'done', ended_at: new Date() }).eq('tournament_name', tName).eq('round_num', round);
            await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF8C00).setTitle(`${tName} — ${round}. kör lezárva!`)] });
          }
          return;
        }

        if (sub === 'message') {
          if (!isAdmin(interaction)) { await interaction.reply({ content: 'Admin jog!', ephemeral: true }); return; }
          const text = interaction.options.getString('text');
          await interaction.channel.send(text);
          await interaction.reply({ content: '✅ Üzenet elküldve.', ephemeral: true });
          return;
        }
      }
    }

    if (interaction.isButton())    { await handleBtn(interaction);  return; }
    if (interaction.isModalSubmit()) { await handleModal(interaction); return; }
  } catch (e) {
    console.error('interaction error:', e);
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Hiba történt.', ephemeral: true }).catch(() => {});
  }
});

client.on('messageCreate', async msg => {
  try { if (!msg.author.bot && !msg.guild) await handleDM(msg); } catch (e) { console.error('DM error:', e); }
});

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
