const fs = require('fs');
const path = require('path');
const {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder
} = require('discord.js');
const { token, clientId, adminId } = require('./config.json');

const PRESENTS_FILE = path.join(__dirname, 'presents.json');

if (!fs.existsSync(PRESENTS_FILE)) {
  fs.writeFileSync(PRESENTS_FILE, JSON.stringify({}));
}

function readPresents() {
  try {
    const data = fs.readFileSync(PRESENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Ошибка чтения presents.json:', err);
    return {};
  }
}

function writePresents(data) {
  try {
    fs.writeFileSync(PRESENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Ошибка записи в presents.json:', err);
  }
}

function getDerangement(array) {
  if (array.length <= 1) return null;

  // Попытка с рандомом
  let attempts = 0;
  const maxAttempts = 200;
  while (attempts < maxAttempts) {
    const shuffled = [...array].sort(() => Math.random() - 0.5);
    if (array.every((val, i) => val !== shuffled[i])) {
      return shuffled;
    }
    attempts++;
  }

  // Fallback: циклический сдвиг
  return [...array.slice(1), array[0]];
}

const commands = [
  {
    name: 'present-prepare-info',
    description: 'Сохранить информацию о подарках (только в ЛС)',
    dm_permission: true,
    options: [
      {
        name: 'кому',
        description: 'Кому предназначен подарок?',
        type: 3,
        required: true,
      },
      {
        name: 'ozon',
        description: 'Адрес ПВЗ Ozon (оставьте пустым, если не нужно)',
        type: 3,
        required: false,
      },
      {
        name: 'wildberries',
        description: 'Адрес ПВЗ Wildberries (оставьте пустым, если не нужно)',
        type: 3,
        required: false,
      },
      {
        name: 'yandex',
        description: 'Адрес ПВЗ Яндекс.Маркет (оставьте пустым, если не нужно)',
        type: 3,
        required: false,
      },
      {
        name: 'дополнительно',
        description: 'Дополнительная информация',
        type: 3,
        required: false,
      },
    ],
  },
  {
    name: 'start-secret-santa',
    description: 'Запустить распределение Тайного Санты (только для админа)',
  },
  {
    name: 'send-present-info',
    description: 'Отправить QR-код и информацию получателю (только в ЛС)',
    dm_permission: true,
    options: [
      {
        name: 'qr',
        description: 'QR-код для получения подарка',
        type: 11, // ATTACHMENT
        required: true,
      },
	  {
        name: 'дополнительно',
        description: 'Дополнительное сообщение к QR-коду',
        type: 3,
        required: false,
      },
    ],
  },
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Регистрация глобальных слэш-команд...');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('Команды успешно зарегистрированы.');
  } catch (error) {
    console.error('Ошибка регистрации команд:', error);
  }
})();

// Важно: добавим интент для получения DM (на всякий случай)
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // === Обработка present-prepare-info ===
  if (interaction.commandName === 'present-prepare-info') {
    if (interaction.guild) {
      return interaction.reply({
        content: '❌ Эта команда доступна **только в личных сообщениях**.',
        ephemeral: true,
      });
    }

    const flm = interaction.options.getString('кому');
    const ozon = interaction.options.getString('ozon') || 'нет';
    const wb = interaction.options.getString('wildberries') || 'нет';
    const ym = interaction.options.getString('yandex') || 'нет';
    const additional = interaction.options.getString('дополнительно') || 'не скажу';

    const presents = readPresents();
    presents[interaction.user.id] = { flm, ozon, wb, ym, additional, gift_to: null };
    writePresents(presents);

    return interaction.reply({
      content: '✅ Данные о подарках сохранены!',
      ephemeral: true,
    });
  }

  // === Обработка start-secret-santa ===
  if (interaction.commandName === 'start-secret-santa') {
    // Отвечаем сразу, чтобы избежать таймаута (особенно если много DM)
    await interaction.deferReply({ ephemeral: true });

    if (interaction.user.id !== adminId) {
      return interaction.editReply('🔒 Эта команда доступна только администратору.');
    }

    const presents = readPresents();
    const userIds = Object.keys(presents);

    if (userIds.length < 2) {
      return interaction.editReply('❌ Нужно минимум 2 участника!');
    }

    const shuffled = getDerangement(userIds);
    if (!shuffled) {
      return interaction.editReply('❌ Не удалось создать распределение.');
    }

    // Обновляем gift_to
    userIds.forEach((userId, i) => {
      presents[userId].gift_to = shuffled[i];
    });

    writePresents(presents);

    // === Отправка ЛС каждому участнику ===
    const failedToSend = [];
    for (const userId of userIds) {
      const recipientId = presents[userId].gift_to;
      const recipientData = presents[recipientId];

      if (!recipientData) continue;

      try {
        const user = await client.users.fetch(userId);
        const message = `
🎅 **Тайный Санта!**

Вы дарите подарок **${recipientData.flm}**!

📦 **Информация о подарке:**
- **Ozon**: ${recipientData.ozon}
- **Wildberries**: ${recipientData.wb}
- **Яндекс.Маркет**: ${recipientData.ym}
- **Дополнительно**: ${recipientData.additional || '—'}

🤫 Не выдавайте себя!
        `.trim();

        await user.send(message);
      } catch (err) {
        console.warn(`Не удалось отправить ЛС пользователю ${userId}:`, err.message);
        failedToSend.push(userId);
      }
    }

    let successMessage = `✅ Тайный Санта запущен! Участников: ${userIds.length}.`;
    if (failedToSend.length > 0) {
      successMessage += `\n⚠️ Не удалось отправить ЛС ${failedToSend.length} участникам (закрыты ЛС).`;
    }

    return interaction.editReply(successMessage);
  }
  
  // === Обработка send-present-info ===
if (interaction.commandName === 'send-present-info') {
  // Только в ЛС
  if (interaction.guild) {
    return interaction.reply({
      content: '❌ Эта команда доступна **только в личных сообщениях**.',
      ephemeral: true,
    });
  }

  const attachment = interaction.options.getAttachment('qr');
  const additionalInfo = interaction.options.getString('дополнительно') || '';

  // Проверяем, что файл — изображение
  if (!attachment || !attachment.contentType?.startsWith('image/')) {
    return interaction.reply({
      content: '❌ Пожалуйста, прикрепите изображение (QR-код).',
      ephemeral: true,
    });
  }

  const presents = readPresents();
  const userId = interaction.user.id;

  // Проверка: пользователь участвует?
  if (!presents[userId] || !presents[userId].gift_to) {
    return interaction.reply({
      content: '❌ Вы не участвуете в Тайном Санте или распределение ещё не запущено.',
      ephemeral: true,
    });
  }

  const recipientId = presents[userId].gift_to;

  // Отвечаем сразу, чтобы избежать таймаута
  await interaction.deferReply({ ephemeral: true });

  try {
    // Получаем пользователя-получателя
    const recipientUser = await client.users.fetch(recipientId);
    
    // Формируем сообщение
    let messageContent = `🎁 **Вам пришёл подарок от Тайного Санты!**`;
    if (additionalInfo) {
      messageContent += `\n\n📝 ${additionalInfo}`;
    }

    // Отправляем ЛС с изображением
    await recipientUser.send({
      content: messageContent,
      files: [attachment.url], // Discord позволяет отправлять по URL
    });

    await interaction.editReply('✅ QR-код и сообщение успешно отправлены получателю!');
  } catch (err) {
    console.error('Ошибка отправки ЛС:', err);
    if (err.code === 50007) {
      await interaction.editReply('❌ Не удалось отправить сообщение получателю — у него закрыты ЛС с ботами.');
    } else {
      await interaction.editReply('❌ Произошла ошибка при отправке. Попробуйте позже.');
    }
  }
}
  
});

client.login(token);