const {
  Client, GatewayIntentBits, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  InteractionType, Partials, ModalBuilder,
  TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

/* ---------- env ---------- */
const GUILD_ID       = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '1504913411010461938';
const ADMIN_IDS      = new Set(
  (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);
const DATA_FILE      = path.join(__dirname, 'data.json');

function loadStore() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { tierlist: {}, teams: {} }; }
}
function saveStore() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

let store = loadStore();

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

/* ---------- in-memory: application conversations ---------- */
const apps = {}; // discordUserId -> { type, answers[], awaitingInput }

/* ---------- embed helpers ---------- */
function qEmbed(n, total, question) {
  return new EmbedBuilder().setColor(0xFF0000).setDescription(`**Kérdés ${n}/${total}**\n${question}`);
}

function logEmbed(user, type, answers) {
  const qs   = type === 'smp' ? SMP_QUESTIONS : STAFF_QUESTIONS;
  const cMap = { smp: 0x00FF00, staff: 0xFF8C00 };
  const lMap = { smp: 'SMP Tag Jelentkezés', staff: 'Staff Jelentkezés' };
  let d = `**Felhasználó:** ${user.tag} (${user.id})\n**Jelentkezés típusa:** ${lMap[type]}\n\n`;
  answers.forEach((a, i) => { d += `**${i+1}.** ${qs[i]}\n**Válasz:** ${a}\n\n`; });
  return new EmbedBuilder().setColor(cMap[type]).setTitle(lMap[type]).setDescription(d).setFooter({ text: `${user.tag} • ${user.id}` });
}

function finishedDM() {
  return new EmbedBuilder().setColor(0x00FF00)
    .setTitle('Jelentkezés Befejezve')
    .setDescription('A jelentkezésed sikeresen leadva. Várj az adminok értékelésére.');
}

function decisionEmbed(reviewerTag, msg, ok) {
  return new EmbedBuilder()
    .setColor(ok ? 0x00FF00 : 0xFF0000)
    .setTitle(ok ? '**Ragna SMP Jelentkezés Elfogadva**' : '**Ragna SMP Jelentkezés Elutasítva**')
    .setDescription(
      `A jelentkezésedet **${reviewerTag}** bírálta el.\n\n` +
      `**Elbíráló üzenete:**\n${msg || '(Nincs üzenet)'}\n\n` +
      `A jelentkezésed ${ok ? 'elfogadásra' : 'elutasításra'} került.`
    );
}

function disabledBtns() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('_x_').setLabel('Elbírálva').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('_x_').setLabel('Elbírálva').setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
}

/* ---------- tierlist ---------- */
function tierEmbed(rank) {
  const players = Object.entries(store.tierlist)
    .filter(([, r]) => r === rank)
    .map(([uid]) => {
      const u = client.users.cache.get(uid);
      return u ? `- ${u.tag}` : null;
    })
    .filter(Boolean)
    .join('\n') || '*Nincs játékos ezen a rangon.*';
  return new EmbedBuilder()
    .setTitle(`Ragna SMP Tierlista — ${rank}`)
    .setColor(0xFF0000).setDescription(players).setTimestamp();
}

async function syncTierlistMsgs(channel) {
  // delete previously tracked tierlist embeds
  const guild = channel.guild;
  if (guild && store._tlMsgs?.[guild.id]) {
    for (const mid of store._tlMsgs[guild.id]) {
      try { await channel.messages.delete(mid).catch(() => {}); } catch {}
    }
  }
  const sent = [];
  for (const r of RANK_ORDER) {
    const m = await channel.send({ embeds: [tierEmbed(r)] });
    sent.push(m.id);
  }
  store._tlMsgs = store._tlMsgs || {};
  store._tlMsgs[guild.id] = sent;
  saveStore();
}

/* ---------- team ---------- */
function teamPoints(team) {
  let p = 0;
  for (const uid of team.members) { const r = store.tierlist[uid]; if (r && RANK_POINTS[r]) p += RANK_POINTS[r]; }
  return p;
}

function teamEmbed(name, team) {
  const pts  = teamPoints(team);
  const rows = RANK_ORDER.map(r => {
    const cnt = team.members.filter(m => store.tierlist[m] === r).length;
    return `**${r}** — ${cnt} játékos (${cnt * (RANK_POINTS[r] || 0)} pont)`;
  });
  const members = team.members.map(uid => {
    const u   = client.users.cache.get(uid);
    const r   = store.tierlist[uid] || '?';
    const tag = u ? u.tag : `Unknown (${uid})`;
    return `${tag} [${r}]`;
  }).join('\n') || '*Nincs tag még.*';

  return new EmbedBuilder()
    .setTitle(`⚔️ ${name}`)
    .setColor(0xFF4500)
    .setDescription(
      `**Összes pont:** ${pts} / ${MAX_TEAM}\n` +
      `${rows.join('\n')}\n\n` +
      `**Tagok:**\n${members}`
    )
    .setFooter({ text: `Vezető: ${(client.users.cache.get(team.leaderId) || { tag: team.leaderId }).tag}` });
}

async function updateQueueEmbed(team, channel) {
  const list = team.queue.map(e => {
    const u = client.users.cache.get(e.discordId);
    return u ? `${u.tag} — ${e.mcName}` : `Unknown — ${e.mcName}`;
  }).join('\n') || '*Üres.*';

  const embed = new EmbedBuilder().setTitle(`${team.name} – Jelentkezési sor`)
    .setColor(0xFFD700).setDescription(list)
    .setFooter({ text: 'A vezető dönthet Elfogadás/Elutasításon.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`qa_${team.name}`).setLabel(`Elfogadás (${team.queue.length})`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`qr_${team.name}`).setLabel('Elutasítás').setStyle(ButtonStyle.Danger),
  );

  let msg;
  if (team.queueMsgId) { try { msg = await channel.messages.fetch(team.queueMsgId); } catch {} }
  if (msg) { await msg.edit({ embeds: [embed], components: [row] }).catch(() => {}); }
  else    { const sent = await channel.send({ embeds: [embed], components: [row] }); team.queueMsgId = sent.id; saveStore(); }
}

async function sendTeamCreate(channel, name, leaderId) {
  const team = { leaderId: String(leaderId), members: [], queue: [], mcNames: {}, createdBy: String(leaderId) };
  store.teams[name] = team;
  saveStore();

  const embed = teamEmbed(name, team);
  const row   = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tj_${name}`).setLabel('Belépés').setStyle(ButtonStyle.Success).setEmoji('➕'),
    new ButtonBuilder().setCustomId(`tl_${name}`).setLabel('Kilépés').setStyle(ButtonStyle.Danger).setEmoji('➖'),
  );
  return channel.send({ embeds: [embed], components: [row] });
}

/* ---------- flow helpers ---------- */
async function startApp(dm, userId, type) {
  const qs    = type === 'smp' ? SMP_QUESTIONS : STAFF_QUESTIONS;
  const total = qs.length;
  apps[userId] = { type, answers: [], awaitingInput: true };
  await dm.send({
    embeds: [new EmbedBuilder().setColor(0xFF0000)
      .setDescription(`**Jelentkezés elkezdve!**\nSorban ${total} kérdést kapsz — válaszolj mindegyiket egy-egy üzenettel.`)],
  });
  await dm.send({ embeds: [qEmbed(1, total, qs[0])] });
}

async function finishApp(user, type, answers) {
  await user.send({ embeds: [finishedDM()] }).catch(() => {});
  const logCh = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (logCh) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ap_${user.id}`).setLabel('Elfogadás').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ar_${user.id}`).setLabel('Elutasítás').setStyle(ButtonStyle.Danger),
    );
    await logCh.send({ embeds: [logEmbed(user, type, answers)], components: [row] }).catch(console.error);
  }
}

/* ---------- button handler ---------- */
async function handleButton(interaction) {
  const c = interaction.customId;

  /* disabled stubs */
  if (c === '_x_') { await interaction.deferUpdate(); return; }

  /* ─── TGFP O L A P ─── */
  if (c === 'apply_smp' || c === 'apply_staff') {
    const type = c === 'apply_smp' ? 'smp' : 'staff';
    try {
      const dm = await interaction.user.createDM();
      await interaction.reply({ content: 'DM csatorna megnyitva, a kérdések ott érkeznek!', ephemeral: true });
      await startApp(dm, interaction.user.id, type);
    } catch {
      await interaction.reply({ content: 'Nem sikerült megnyitni a DM-et. Nyisd meg a beállításaidban!', ephemeral: true });
    }
    return;
  }

  /* ─── Tierlist ─── */
  if (c === 'tierlist_reload') {
    await interaction.deferReply({ ephemeral: true });
    try {
      await syncTierlistMsgs(interaction.channel);
      await interaction.editReply({ content: '✅ Tierlista frissítve!' });
    } catch(e) {
      console.error(e);
      await interaction.followUp({ content: '❌ Hiba a tierlista frissítése közben.', ephemeral: true });
    }
    return;
  }

  /* ─── Team join ─── */
  if (c.startsWith('tj_')) {
    const name  = c.slice(3);
    const uid   = String(interaction.user.id);

    if (Object.values(store.teams).some(t => t.members.includes(uid) || t.leaderId === uid)) {
      await interaction.reply({ content: 'Már egy másik csapatban vagy!', ephemeral: true }); return;
    }
    if (!store.tierlist[uid]) {
      await interaction.reply({ content: 'Először szerezned kell egy rangot a tierlistán, mielőtt csapatba léphetnél!', ephemeral: true });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`joinm_${uid}_${name}`)
      .setTitle(`Belépés: ${name}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('mc').setLabel('Minecraft Felhasználónév')
            .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Írd be a Minecraft neved...'),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  /* ─── Team leave ─── */
  if (c.startsWith('tl_')) {
    const name = c.slice(3);
    const team = store.teams[name];
    if (!team) { await interaction.reply({ content: 'Nem létező csapat.', ephemeral: true }); return; }

    const uid = String(interaction.user.id);
    if (uid === team.leaderId) {
      await interaction.reply({ content: 'A vezető nem léphet ki! Használd a /teamdeletet vagy a /teamleadert.', ephemeral: true }); return;
    }
    const i = team.members.indexOf(uid);
    if (i === -1) { await interaction.reply({ content: 'Nem vagy tagja ennek a csapatnak.', ephemeral: true }); return; }

    team.members.splice(i, 1);
    delete team.mcNames[uid];
    saveStore();

    const ch = interaction.channel;
    if (ch) {
      // Delete old team embed and post a new one so the embed changes
      const tank = await teamEmbed(name, team);
      await interaction.followUp({ embeds: [tank], ephemeral: false }).catch(() => {});
    }

    await interaction.reply({ content: `Kiléptél a **${name}** csapatból.`, ephemeral: true }).catch(() => {});
    return;
  }

  /* ─── Queue: accept ─── */
  if (c.startsWith('qa_')) {
    const name = c.slice(3);
    const team = store.teams[name];
    if (!team) return;

    if (String(interaction.user.id) !== team.leaderId && !ADMIN_IDS.has(String(interaction.user.id))) {
      await interaction.reply({ content: 'Csak a csapat vezetője vagy egy admin csinálhatja!', ephemeral: true }); return;
    }
    if (team.queue.length === 0) { await interaction.reply({ content: 'Nincs kiálló jelentkezés.', ephemeral: true }); return; }

    const entry = team.queue.shift();
    team.members.push(entry.discordId);
    team.mcNames[entry.discordId] = entry.mcName;
    saveStore();

    await interaction.reply({ content: `✅ **${entry.mcName}** hozzáadva a **${name}** csapathoz!`, ephemeral: false }).catch(() => {});
    const ch = interaction.channel; if (ch) await updateQueueEmbed(team, ch).catch(() => {});
    return;
  }

  /* ─── Queue: reject ─── */
  if (c.startsWith('qr_')) {
    const name = c.slice(3);
    const team = store.teams[name];
    if (!team) return;

    if (String(interaction.user.id) !== team.leaderId && !ADMIN_IDS.has(String(interaction.user.id))) {
      await interaction.reply({ content: 'Csak a csapat vezetője vagy egy admin csinálhatja!', ephemeral: true }); return;
    }
    if (team.queue.length === 0) { await interaction.reply({ content: 'Nincs kiálló jelentkezés.', ephemeral: true }); return; }

    const entry = team.queue.shift();
    saveStore();

    await interaction.reply({ content: `❌ **${entry.mcName}** jelentkezése elutasítva.`, ephemeral: false }).catch(() => {});
    const ch = interaction.channel; if (ch) await updateQueueEmbed(team, ch).catch(() => {});
    return;
  }

  /* ─── Review: approve ─── */
  if (c.startsWith('ap_')) {
    const userId = c.slice(3);
    const modal  = new ModalBuilder().setCustomId(`apm_${userId}`)
      .setTitle('Jelentkezés elfogadása')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('msg').setLabel('Elbíráló üzenet (opcionális)')
            .setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('Üzenet a jelentkezőnek...'),
        ),
      );
    await interaction.showModal(modal); return;
  }

  /* ─── Review: reject ─── */
  if (c.startsWith('ar_')) {
    const userId = c.slice(3);
    const modal  = new ModalBuilder().setCustomId(`arm_${userId}`)
      .setTitle('Jelentkezés elutasítása')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('reason').setLabel('Elutasítás indoklása')
            .setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('Miért utasítod el?'),
        ),
      );
    await interaction.showModal(modal); return;
  }
}

/* ---------- modal handler ---------- */
async function handleModal(interaction) {
  const c = interaction.customId;

  /* approve modal */
  if (c.startsWith('apm_')) {
    const userId = c.slice(4);
    const msg    = interaction.fields.getTextInputValue('msg') || '';
    await sendDecision(userId, interaction.user.tag, msg, true);
    try { await interaction.message.edit({ components: [disabledBtns()] }); } catch {}
    await interaction.reply({ content: 'Elfogadva, DM elküldve.', ephemeral: true }).catch(() => {});
    return;
  }

  /* reject modal */
  if (c.startsWith('arm_')) {
    const userId = c.slice(4);
    const reason = interaction.fields.getTextInputValue('reason');
    await sendDecision(userId, interaction.user.tag, reason, false);
    try { await interaction.message.edit({ components: [disabledBtns()] }); } catch {}
    await interaction.reply({ content: 'Elutasítva, DM elküldve.', ephemeral: true }).catch(() => {});
    return;
  }

  /* team join — mc name */
  if (c.startsWith('joinm_')) {
    const parts  = c.split('_');
    const uid    = parts[1];
    const tName  = c.slice(c.lastIndexOf('_') + 1);
    const mcName = interaction.fields.getTextInputValue('mc').trim();

    if (!store.tierlist[uid]) {
      await interaction.reply({ content: 'Nincs rangsorod a tierlistán! Nem léphetsz csapatba.', ephemeral: true });
      return;
    }
    const inAnother = Object.values(store.teams).some(t => t.members.includes(uid) || t.leaderId === uid);
    if (inAnother) { await interaction.reply({ content: 'Már egy másik csapatban vagy!', ephemeral: true }); return; }

    const team = store.teams[tName];
    if (!team) { await interaction.reply({ content: 'A csapat nem létezik.', ephemeral: true }); return; }
    team.queue.push({ discordId: uid, mcName });
    saveStore();

    await interaction.reply({ content: `Jelentkezésed elküldve a **${tName}** vezetőjének!`, ephemeral: true }).catch(() => {});
    const ch = interaction.channel;
    if (ch) await updateQueueEmbed(team, ch).catch(() => {});
    return;
  }
}

async function sendDecision(userId, tag, msg, ok) {
  const u = await client.users.fetch(userId).catch(() => null);
  if (u) try { await u.send({ embeds: [decisionEmbed(tag, msg, ok)] }); } catch {}
}

/* ---------- DM handler ---------- */
async function handleDm(message) {
  const app = apps[message.author.id];
  if (!app || !app.awaitingInput) return;

  app.answers.push(message.content);
  const qs    = app.type === 'smp' ? SMP_QUESTIONS : STAFF_QUESTIONS;
  const total = qs.length;

  if (app.answers.length >= total) {
    app.awaitingInput = false;
    await finishApp(message.author, app.type, app.answers);
    return;
  }

  const n = app.answers.length + 1;
  await message.author.send({ embeds: [qEmbed(n, total, qs[n-1])] }).catch(console.error);
}

/* ---------- command registration ---------- */
const COMMANDS = [
  new SlashCommandBuilder().setName('tgfpanel').setDescription('Jelentkezési panel').setDMPermission(false),

  new SlashCommandBuilder().setName('tierlist')
    .setDescription('Tierlista embedek megjelenítése')
    .addStringOption(o => o.setName('rank').setDescription('Egyetlen rang megjelenítése').setRequired(false)
      .addChoices(
        { name: 'S', value: 'S' }, { name: 'A', value: 'A' },
        { name: 'B', value: 'B' }, { name: 'C', value: 'C' },
        { name: 'D', value: 'D' }, { name: 'F', value: 'F' },
      )),

  new SlashCommandBuilder().setName('tierlistadd')
    .setDescription('Játékos hozzáadása a tierlistához')
    .addStringOption(o => o.setName('player').setDescription('Játékos Discord neve').setRequired(true))
    .addStringOption(o => o.setName('rank').setDescription('Rang').setRequired(true)
      .addChoices(
        { name: 'S', value: 'S' }, { name: 'A', value: 'A' },
        { name: 'B', value: 'B' }, { name: 'C', value: 'C' },
        { name: 'D', value: 'D' }, { name: 'F', value: 'F' },
      )),

  new SlashCommandBuilder().setName('teamcreate')
    .setDescription('Új csapat létrehozása')
    .addStringOption(o => o.setName('name').setDescription('Csapat neve').setRequired(true)),

  new SlashCommandBuilder().setName('teamdelete')
    .setDescription('Csapat törlése (admin)')
    .addStringOption(o => o.setName('name').setDescription('Csapat neve').setRequired(true)),

  new SlashCommandBuilder().setName('teamleader')
    .setDescription('Csapat vezetőjének megváltoztatása (admin)')
    .addStringOption(o => o.setName('name').setDescription('Csapat neve').setRequired(true))
    .addUserOption(o => o.setName('user').setDescription('Új vezető').setRequired(true)),

  new SlashCommandBuilder().setName('tierlist')
    .setDescription('Tierlista embedek küldése')
    .addStringOption(o => o.setName('rank').setDescription('Rang').setRequired(false)
      .addChoices(
        { name: 'S', value: 'S' }, { name: 'A', value: 'A' },
        { name: 'B', value: 'B' }, { name: 'C', value: 'C' },
        { name: 'D', value: 'D' }, { name: 'F', value: 'F' },
      )),
];

async function registerCommands() {
  if (GUILD_ID) {
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (guild) {
      for (const cmd of COMMANDS) { await guild.commands.create(cmd).catch(console.error); }
      console.log(`Commands → guild "${guild.name}" (${GUILD_ID})`);
      return;
    }
  }
  for (const cmd of COMMANDS) { await client.application.commands.create(cmd).catch(console.error); }
  console.log('Commands → global');
}

/* ---------- events ---------- */
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.type === InteractionType.ApplicationCommand) {
      const n = interaction.commandName;

      /* TGFP O  L  A  P */
      if (n === 'tgfpanel') {
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xFF0000)
            .setTitle('Jelentkezés')
            .setDescription(
              '**Jelentkezés**\n\n' +
              'Válaszd ki, melyik staff pozícióra szeretnél jelentkezni.\n\n' +
              '**Fontos tudnivalók:**\n' +
              '1. Egy adott pozícióra 30 naponta egyszer tudsz jelentkezni.\n' +
              '2. A jelentkezést privát üzenetben kell kitöltened.\n' +
              '3. A kitöltésre legfeljebb 60 perced van.\n' +
              '4. A kérdéseket sorban kapod meg, visszalépni vagy átugrani nem lehet.\n' +
              '5. A megválaszolt kérdésidet a Crystal Managment tagok illetve staffok fogják átnézni.'
            )],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('apply_smp').setLabel('SMP Tag').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('apply_staff').setLabel('Staff').setStyle(ButtonStyle.Primary),
          )],
        });
        return;
      }

      /* ti.e.r. l. i.s.t */
      if (n === 'tierlist') {
        const rank = interaction.options.getString('rank');
        if (rank) {
          await interaction.reply({ embeds: [tierEmbed(rank)] });
        } else {
          await interaction.deferReply();
          await syncTierlistMsgs(interaction.channel);
          await interaction.followUp('✅ Tierlista 6 embed elküldve!');
        }
        return;
      }

      /* tierlistadd */
      if (n === 'tierlistadd') {
        const player = interaction.options.getString('player').toLowerCase();
        const rank   = interaction.options.getString('rank');
        if (!player || !rank || !RANK_ORDER.includes(rank)) {
          await interaction.reply({ content: 'Érvényes játékosnévet és rangot add meg!', ephemeral: true }); return;
        }
        const targetUser = interaction.options.getString('player');
        store.tierlist[targetUser] = rank;
        saveStore();
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(0x00FF00)
            .setTitle('Rang hozzáadva')
            .setDescription(`**${targetUser}** → **${rank}** rangsorhoz adva!`)],
          ephemeral: true,
        });
        return;
      }

      /* teamcreate */
      if (n === 'teamcreate') {
        const name = interaction.options.getString('name');
        if (store.teams[name]) { await interaction.reply({ content: 'Ez a csapatnév már létezik!', ephemeral: true }); return; }
        await interaction.deferReply();
        try {
          await sendTeamCreate(interaction.channel, name, interaction.user.id);
          await interaction.followUp(`✅ **${name}** csapat létrehozva!`);
        } catch(e) {
          await interaction.followUp(`❌ Hiba: ${e.message}`);
        }
        return;
      }

      /* teamdelete — admin only */
      if (n === 'teamdelete') {
        if (!ADMIN_IDS.has(String(interaction.user.id))) {
          await interaction.reply({ content: 'Admin jog szükséges!', ephemeral: true }); return;
        }
        const name  = interaction.options.getString('name');
        const team  = store.teams[name];
        if (!team) { await interaction.reply({ content: 'Nem létező csapat.', ephemeral: true }); return; }
        const pts   = teamPoints(team);
        delete store.teams[name];
        saveStore();
        await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFF0000)
          .setTitle('Csapat törölve')
          .setDescription(`**${name}** törölve.\nVolt pontszáma: **${pts}** / ${MAX_TEAM}`)] });
        return;
      }

      /* teamleader — admin only */
      if (n === 'teamleader') {
        if (!ADMIN_IDS.has(String(interaction.user.id))) {
          await interaction.reply({ content: 'Admin jog szükséges!', ephemeral: true }); return;
        }
        const name = interaction.options.getString('name');
        const user = interaction.options.getUser('user');
        const team = store.teams[name];
        if (!team) { await interaction.reply({ content: 'Nem létező csapat.', ephemeral: true }); return; }
        if (!user) { await interaction.reply({ content: 'Adj meg egy usert.', ephemeral: true }); return; }

        const oldId = team.leaderId;
        team.leaderId = String(user.id);
        saveStore();

        const oldTag = (client.users.cache.get(oldId) || { tag: oldId }).tag;
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xFF8C00)
            .setTitle('Vezető váltás')
            .setDescription(`**${name}** konk vezetője: **${user.tag}**\nRégi vezető: ${oldTag}`)],
        });
        return;
      }
    }

    if (interaction.isButton())    { await handleButton(interaction);  return; }
    if (interaction.isModalSubmit()) { await handleModal(interaction); return; }
  } catch (e) {
    console.error('interaction error:', e);
    if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Hiba történt.', ephemeral: true }).catch(() => {});
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (message.guild)    return;
    await handleDm(message);
  } catch (e) { console.error('DM error:', e); }
});

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
