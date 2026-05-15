const {
  Client, GatewayIntentBits, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  InteractionType, Partials, ModalBuilder,
  TextInputBuilder, TextInputStyle
} = require('discord.js');
require('dotenv').config();

const LOG_CHANNEL_ID = '1504913411010461938';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

/** ---------- question banks ---------- **/
const SMP_TAG_QUESTIONS = [
  'Mi a minecraft neved?',
  'Mi a discord neved?',
  'Hány éves vagy?',
  'Milyen céllal jösz a szerverre?',
  'Milyen képességeid vannak a minecrafton belül és 10/? mennyire jók?',
  'Van tapasztalatod smpkben?',
  'Milyen smpken játszottál már?',
  'Mennyi ideje játszol minecraftot?',
  'Mennyi időt tudnál aktiv lenni a szerveren?',
  'Videós vagy? Ha igen készítenél videót?',
];

const STAFF_QUESTIONS = [
  'Mi a minecraft neved?',
  'Mi a discord neved?',
  'Hány éves vagy?',
  'Milyen pozícióra jelentkezel?',
  'Mióta vagy a Ragna SMP közösségnek a tagja?',
  'Mennyi időt tudsz aktívan a szerverre fordítani?',
  'Tisztában vagy-e a szabályokkal és betudod-e azt tartatni?',
  'Mit tennél ha egy másik staff tévedne?',
  'Mit gondolsz a gyűlöhetbeszédről és toxikus viselkedésről?',
  'Mit tennél, ha nem lennél biztos valamiben?',
  'Van e staff tapasztalod, ha igen hol?',
  'Elfogadod, ha egy magasabb rangú staff felülbírál?',
  'Miért fontos szerinted, hogy részletesen tudd a szabályzatot?',
  'Miért téged válasszunk?',
  'Van valami egyéb dolog amit szeretnél hogy tudjunk rólad?',
];

/** ---------- in-memory state ---------- **/
const apps = {};

/** ---------- embed builders ---------- **/
function questionEmbed(n, total, q) {
  return new EmbedBuilder().setColor(0xFF0000).setDescription(`**Kérdés ${n}/${total}**\n${q}`);
}

function logEmbed(user, type, answers) {
  const questions = type === 'smp' ? SMP_TAG_QUESTIONS : STAFF_QUESTIONS;
  const colorMap = { smp: 0x00FF00, staff: 0xFF8C00 };
  const labelMap = { smp: 'SMP Tag Jelentkezés', staff: 'Staff Jelentkezés' };
  let desc = `**Felhasználó:** ${user.tag} (${user.id})\n` +
              `**Jelentkezés típusa:** ${labelMap[type]}\n\n`;
  answers.forEach((ans, i) => {
    desc += `**${i + 1}.** ${questions[i]}\n**Válasz:** ${ans}\n\n`;
  });
  return new EmbedBuilder()
    .setColor(colorMap[type] || 0x00FF00)
    .setTitle(labelMap[type] || 'Jelentkezés')
    .setDescription(desc)
    .setFooter({ text: `${user.tag} • ${user.id}` });
}

function finishedDMEmbed(type) {
  return new EmbedBuilder()
    .setColor(type === 'staff' ? 0xFF8C00 : 0x00FF00)
    .setTitle('Jelentkezés Befejezve')
    .setDescription('A jelentkezésed sikeresen leadva. Várj az adminok értékelésére.');
}

function decisionEmbed(reviewerTag, reviewerId, msg, approved) {
  return new EmbedBuilder()
    .setColor(approved ? 0x00FF00 : 0xFF0000)
    .setTitle(approved
      ? '**Ragna SMP Jelentkezés Elfogadva**'
      : '**Ragna SMP Jelentkezés Elutasítva**')
    .setDescription(
      `A jelentkezésedet **${reviewerTag}** bírálta el.\n\n` +
      `**Elbíráló üzenete:**\n${msg || '(Nincs üzenet)'}\n\n` +
      `A jelentkezésed ${approved ? 'elfogadásra' : 'elutasításra'} került.`
    );
}

function disabledRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('done').setLabel('Elbírálva').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('done').setLabel('Elbírálva').setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
}

/** ---------- flow helpers ---------- **/
async function startApplication(dmChannel, userId, type) {
  const questions = type === 'smp' ? SMP_TAG_QUESTIONS : STAFF_QUESTIONS;
  const total = questions.length;

  apps[userId] = { type, answers: [], awaitingInput: true };

  await dmChannel.send({
    embeds: [new EmbedBuilder()
      .setColor(0xFF0000)
      .setDescription(`**Jelentkezés elkezdve!**\nSorban ${total} kérdést kapsz, válaszolj mindeniket egy-egy üzenettel.`)],
  });

  await dmChannel.send({ embeds: [questionEmbed(1, total, questions[0])] });
}

async function finishApplication(user, type, answers) {
  await user.send({ embeds: [finishedDMEmbed(type)] }).catch(() => {});

  const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (logChannel) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve_${user.id}`).setLabel('Elfogadás').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject_${user.id}`).setLabel('Elutasítás').setStyle(ButtonStyle.Danger),
    );
    await logChannel.send({ embeds: [logEmbed(user, type, answers)], components: [row] }).catch(console.error);
  }
}

async function handleButton(interaction) {
  if (interaction.customId === 'done') { await interaction.deferUpdate(); return; }

  // Application buttons
  if (interaction.customId === 'apply_smp' || interaction.customId === 'apply_staff') {
    const type = interaction.customId === 'apply_smp' ? 'smp' : 'staff';
    try {
      await interaction.reply({
        content: 'DM csatorna megnyitva, a kérdések ott érkeznek!',
        ephemeral: true,
      });
      const dm = await interaction.user.createDM();
      await startApplication(dm, interaction.user.id, type);
    } catch {
      await interaction.reply({
        content: 'Nem sikerült megnyitni a DM-et. Nyisd meg a beállításaidban!',
        ephemeral: true,
      });
    }
    return;
  }

  // Approve
  if (interaction.customId.startsWith('approve_')) {
    const userId = interaction.customId.split('_')[1];
    const modal = new ModalBuilder()
      .setCustomId(`approve_modal_${userId}`)
      .setTitle('Jelentkezés elfogadása')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('message')
            .setLabel('Elbíráló üzenet (opcionális)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('Írd ide az elfogadási üzenetet...'),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // Reject
  if (interaction.customId.startsWith('reject_')) {
    const userId = interaction.customId.split('_')[1];
    const modal = new ModalBuilder()
      .setCustomId(`reject_modal_${userId}`)
      .setTitle('Jelentkezés elutasítása')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Elutasítás indoklása')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setPlaceholder('Add meg az elutasítás okát...'),
        ),
      );
    await interaction.showModal(modal);
    return;
  }
}

async function handleModal(interaction) {
  // Approve modal
  if (interaction.customId.startsWith('approve_modal_')) {
    const userId = interaction.customId.split('_').pop();
    const msg = interaction.fields.getTextInputValue('message') || '';
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
      try { await user.send({ embeds: [decisionEmbed(interaction.user.tag, interaction.user.id, msg, true)] }); } catch {}
    }
    try { await interaction.message.edit({ components: [disabledRow()] }); } catch {}
    await interaction.reply({ content: 'Elfogadva, DM elküldve a jelentkezőnek.', ephemeral: true }).catch(console.error);
    return;
  }

  // Reject modal
  if (interaction.customId.startsWith('reject_modal_')) {
    const userId = interaction.customId.split('_').pop();
    const reason = interaction.fields.getTextInputValue('reason');
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) {
      try { await user.send({ embeds: [decisionEmbed(interaction.user.tag, interaction.user.id, reason, false)] }); } catch {}
    }
    try { await interaction.message.edit({ components: [disabledRow()] }); } catch {}
    await interaction.reply({ content: 'Elutasítva, DM elküldve a jelentkezőnek.', ephemeral: true }).catch(console.error);
    return;
  }
}

async function handleDmReply(message) {
  const app = apps[message.author.id];
  if (!app || !app.awaitingInput) return;

  app.answers.push(message.content);
  const questions = app.type === 'smp' ? SMP_TAG_QUESTIONS : STAFF_QUESTIONS;
  const total = questions.length;

  if (app.answers.length >= total) {
    app.awaitingInput = false;
    await finishApplication(message.author, app.type, app.answers);
    return;
  }

  const n = app.answers.length + 1;
  await message.author.send({ embeds: [questionEmbed(n, total, questions[n - 1])] }).catch(console.error);
}

/** ---------- env ---------- **/
const GUILD_ID = process.env.GUILD_ID; // optional — instant guild syncing
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '1504913411010461938';

/** ---------- events ---------- **/
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const payload = new SlashCommandBuilder()
      .setName('tgfpanel')
      .setDescription('Ragna SMP jelentkezési panel')
      .setDMPermission(false);

    if (GUILD_ID) {
      const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
      if (guild) {
        await guild.commands.create(payload);
        console.log(`/tgfpanel registered to guild ${guild.name} (${GUILD_ID}).`);
      } else {
        console.warn(`GUILD_ID ${GUILD_ID} not found, falling back to global.`);
        await client.application.commands.create(payload);
      }
    } else {
      await client.application.commands.create(payload);
      console.log('/tgfpanel registered globally (may take up to ~1 hour to propagate).');
    }
  } catch (e) {
    console.error('Slash command registration failed:', e);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.type === InteractionType.ApplicationCommand) {
      if (interaction.commandName === 'tgfpanel') {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
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
          );
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('apply_smp').setLabel('SMP Tag').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('apply_staff').setLabel('Staff').setStyle(ButtonStyle.Primary),
        );
        await interaction.reply({ embeds: [embed], components: [row] });
      }
      return;
    }
    if (interaction.isButton())    { await handleButton(interaction);   return; }
    if (interaction.isModalSubmit()) { await handleModal(interaction);  return; }
  } catch (e) {
    console.error('interactionCreate error:', e);
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    if (message.guild)    return;
    await handleDmReply(message);
  } catch (e) {
    console.error('messageCreate error:', e);
  }
});

client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);
