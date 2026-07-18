// index.js - Main Bot File with GitHub Backup
const { Telegraf, Markup, session } = require('telegraf');
const { message } = require('telegraf/filters');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs-extra');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const ytdl = require('ytdl-core');
const YouTube = require('youtube-sr').default;
const moment = require('moment');
const archiver = require('archiver');
const { Octokit } = require('@octokit/rest');
const config = require('./config');

// ============================================
// GITHUB STORAGE SYSTEM
// ============================================
class GitHubStorage {
  constructor() {
    this.octokit = new Octokit({ auth: config.GITHUB.token });
    this.owner = config.GITHUB.username;
    this.repo = config.GITHUB.repo;
    this.branch = config.GITHUB.branch;
    this.rawUrl = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}`;
    this.repoUrl = `https://github.com/${this.owner}/${this.repo}`;
    this.dataFile = 'data.json';
  }

  async initRepo() {
    try {
      await this.octokit.repos.get({
        owner: this.owner,
        repo: this.repo
      });
      console.log('✅ GitHub repo found');
      return true;
    } catch (error) {
      if (error.status === 404) {
        try {
          await this.octokit.repos.createForAuthenticatedUser({
            name: this.repo,
            description: 'Bot Data Storage',
            private: false,
            auto_init: true
          });
          console.log('✅ GitHub repo created');
          return true;
        } catch (err) {
          console.error('❌ Failed to create repo:', err.message);
          return false;
        }
      }
      return false;
    }
  }

  async uploadFile(content, filename, message = `Update ${filename}`) {
    try {
      const base64Content = Buffer.from(content).toString('base64');
      
      let sha = null;
      try {
        const existing = await this.octokit.repos.getContent({
          owner: this.owner,
          repo: this.repo,
          path: filename,
          ref: this.branch
        });
        sha = existing.data.sha;
      } catch (error) {}

      await this.octokit.repos.createOrUpdateFileContents({
        owner: this.owner,
        repo: this.repo,
        path: filename,
        message: `${message} - ${moment().format('YYYY-MM-DD HH:mm:ss')}`,
        content: base64Content,
        branch: this.branch,
        sha: sha
      });

      return { 
        success: true, 
        url: `${this.rawUrl}/${filename}`,
        repoUrl: `${this.repoUrl}/blob/${this.branch}/${filename}`
      };
    } catch (error) {
      console.error('Upload error:', error);
      return { success: false, message: error.message };
    }
  }

  async uploadAllFiles() {
    const files = [
      { name: 'index.js', path: 'index.js' },
      { name: 'config.js', path: 'config.js' },
      { name: 'package.json', path: 'package.json' },
      { name: 'data.json', path: 'data.json' }
    ];

    if (fs.existsSync(config.BACKUP_DIR)) {
      const backupFiles = fs.readdirSync(config.BACKUP_DIR);
      for (const bf of backupFiles) {
        files.push({ name: bf, path: `backups/${bf}` });
      }
    }

    const results = {};
    for (const file of files) {
      if (fs.existsSync(file.path)) {
        const content = fs.readFileSync(file.path);
        const result = await this.uploadFile(content, file.path, `Backup ${file.name}`);
        results[file.name] = result;
      }
    }
    return results;
  }

  async createFullBackup() {
    await this.uploadFile(
      JSON.stringify(data, null, 2),
      'data.json',
      'Backup data'
    );

    const results = await this.uploadAllFiles();
    
    const summary = {
      repoUrl: this.repoUrl,
      files: {},
      timestamp: moment().format('YYYY-MM-DD HH:mm:ss')
    };

    for (const [key, value] of Object.entries(results)) {
      if (value && value.success) {
        summary.files[key] = {
          url: value.url,
          repoUrl: value.repoUrl
        };
      }
    }
    return summary;
  }

  async listFiles() {
    try {
      const response = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: '',
        ref: this.branch
      });

      const files = [];
      for (const item of response.data) {
        if (item.type === 'file') {
          files.push({
            name: item.name,
            path: item.path,
            url: `${this.rawUrl}/${item.path}`,
            repoUrl: `${this.repoUrl}/blob/${this.branch}/${item.path}`,
            size: item.size,
            sha: item.sha
          });
        }
      }
      return files;
    } catch (error) {
      return [];
    }
  }

  getRepoUrl() {
    return this.repoUrl;
  }
}

// ============================================
// INIT GITHUB STORAGE
// ============================================
const github = new GitHubStorage();

// ============================================
// DATA STORE (JSON)
// ============================================
let data = {
  users: [],
  groups: [],
  muteLogs: [],
  backups: [],
  admins: [],
  filters: {},
  settings: {
    antiToxic: false,
    antiLink: false,
    isMaintenance: false,
    maintenanceMessage: config.MAINTENANCE_MESSAGE
  }
};

// ============================================
// FUNGSI DATABASE CRUD (DIPERBAIKI)
// ============================================
function findUser(userId) {
  return data.users.find(u => u.userId === userId.toString());
}

function findUserIndex(userId) {
  return data.users.findIndex(u => u.userId === userId.toString());
}

function saveUser(user) {
  const index = findUserIndex(user.userId);
  if (index !== -1) {
    data.users[index] = { ...data.users[index], ...user };
  } else {
    data.users.push(user);
  }
  saveData();
  return user;
}

function getUsers() {
  return data.users;
}

function findGroup(groupId) {
  return data.groups.find(g => g.groupId === groupId.toString());
}

function findGroupIndex(groupId) {
  return data.groups.findIndex(g => g.groupId === groupId.toString());
}

function saveGroup(group) {
  const index = findGroupIndex(group.groupId);
  if (index !== -1) {
    data.groups[index] = { ...data.groups[index], ...group };
  } else {
    data.groups.push(group);
  }
  saveData();
  return group;
}

// ============================================
// LOAD & SAVE DATA
// ============================================
function loadData() {
  try {
    if (fs.existsSync(config.DATA_FILE)) {
      const raw = fs.readFileSync(config.DATA_FILE, 'utf8');
      data = JSON.parse(raw);
      console.log('✅ Data loaded from local file');
    } else {
      saveData();
      console.log('✅ New data file created');
    }
  } catch (error) {
    console.error('❌ Error loading data:', error);
    saveData();
  }
}

async function saveData() {
  try {
    fs.writeFileSync(config.DATA_FILE, JSON.stringify(data, null, 2));
    console.log('✅ Data saved locally');
    
    await github.uploadFile(
      JSON.stringify(data, null, 2),
      'data.json',
      'Update data'
    );
  } catch (error) {
    console.error('❌ Error saving data:', error);
  }
}

// ============================================
// FORMAT BLOCKQUOTE
// ============================================
const q = (text) => `<blockquote>${text}</blockquote>`;

// ============================================
// PROGRESS UI
// ============================================
async function showProgress(ctx, message, current, total, emoji = '⏳') {
  const percentage = Math.round((current / total) * 100);
  const barLength = 20;
  const filled = Math.round((percentage / 100) * barLength);
  const empty = barLength - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  
  return q(
    `${emoji} *${message}*\n\n` +
    `┌─────────────────────┐\n` +
    `│ ${bar} │\n` +
    `└─────────────────────┘\n\n` +
    `📊 *Progress:* ${percentage}%\n` +
    `📌 *Status:* ${current}/${total}`
  );
}

// ============================================
// HAPUS PESAN
// ============================================
async function deletePreviousMessages(ctx) {
  try {
    if (ctx.session.lastMessageIds && ctx.session.lastMessageIds.length > 0) {
      for (const msgId of ctx.session.lastMessageIds) {
        try { await ctx.deleteMessage(msgId); } catch (e) {}
      }
      ctx.session.lastMessageIds = [];
    }
    
    if (ctx.callbackQuery?.message?.message_id) {
      try { await ctx.deleteMessage(ctx.callbackQuery.message.message_id); } catch (e) {}
    }
  } catch (error) {}
}

async function saveMessageId(ctx, messageId) {
  if (!ctx.session.lastMessageIds) {
    ctx.session.lastMessageIds = [];
  }
  ctx.session.lastMessageIds.push(messageId);
  if (ctx.session.lastMessageIds.length > 50) {
    ctx.session.lastMessageIds.shift();
  }
}

// ============================================
// FUNGSI CEK ADMIN
// ============================================
async function isUserAdmin(userId) {
  if (userId === config.OWNER_ID) return true;
  const user = findUser(userId);
  if (user && user.isAdmin) return true;
  return data.admins.includes(userId.toString());
}

// ============================================
// FUNGSI CEK JOIN CHANNEL
// ============================================
async function isUserJoinedChannel(userId) {
  try {
    const member = await bot.telegram.getChatMember(config.CHANNEL_ID, userId);
    return member.status !== 'left' && member.status !== 'kicked';
  } catch (error) {
    return false;
  }
}

// ============================================
// FUNGSI CEK BOT ADMIN DI GRUP
// ============================================
async function isBotAdminInGroup(groupId) {
  try {
    const botMember = await bot.telegram.getChatMember(groupId, bot.botInfo.id);
    return botMember.status === 'administrator' || botMember.status === 'creator';
  } catch (error) {
    return false;
  }
}

// ============================================
// FUNGSI PARSE DURATION
// ============================================
function parseDuration(duration) {
  const units = { 'd': 86400000, 'h': 3600000, 'm': 60000, 's': 1000, 'M': 2592000000, 'y': 31536000000 };
  const match = duration.match(/^(\d+)([dhmsMy])$/);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2];
  if (!units[unit]) return null;
  return value * units[unit];
}

// ============================================
// FUNGSI UPLOAD KE CATBOX
// ============================================
async function uploadToCatbox(buffer, filename) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('fileToUpload', buffer, { filename });
  
  try {
    const response = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: { ...form.getHeaders() }
    });
    
    if (response.data && response.data.startsWith('https://')) {
      return { success: true, url: response.data };
    }
    return { success: false, error: 'Upload failed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// FUNGSI BUAT CANVAS CEK ID
// ============================================
async function createIdCard(user) {
  const canvas = createCanvas(800, 500);
  const ctx = canvas.getContext('2d');
  
  const gradient = ctx.createLinearGradient(0, 0, 800, 500);
  gradient.addColorStop(0, '#1a1a2e');
  gradient.addColorStop(0.5, '#16213e');
  gradient.addColorStop(1, '#0f3460');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 800, 500);
  
  ctx.strokeStyle = '#00d2ff';
  ctx.lineWidth = 5;
  ctx.strokeRect(20, 20, 760, 460);
  
  try {
    const photoUrl = await bot.telegram.getUserProfilePhotos(user.id, 0, 1);
    if (photoUrl.total_count > 0) {
      const fileId = photoUrl.photos[0][0].file_id;
      const file = await bot.telegram.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
      const response = await axios({ url, responseType: 'arraybuffer' });
      const img = await loadImage(Buffer.from(response.data));
      ctx.save();
      ctx.beginPath();
      ctx.arc(150, 150, 80, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 70, 70, 160, 160);
      ctx.restore();
    } else {
      ctx.fillStyle = '#00d2ff';
      ctx.beginPath();
      ctx.arc(150, 150, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 60px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(user.first_name?.charAt(0) || '?', 150, 160);
    }
  } catch (error) {}
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`👤 ${user.first_name || 'Unknown'}`, 280, 100);
  ctx.fillStyle = '#00d2ff';
  ctx.font = '20px Arial';
  ctx.fillText(`🆔 ID: ${user.id}`, 280, 150);
  ctx.fillStyle = '#ffd700';
  ctx.font = '18px Arial';
  ctx.fillText(`📛 Username: @${user.username || 'Tidak ada'}`, 280, 190);
  ctx.fillStyle = '#00ff88';
  ctx.font = '18px Arial';
  ctx.fillText(`📡 DC: ${user.dc_id || 'N/A'}`, 280, 230);
  ctx.fillStyle = '#ff6b6b';
  ctx.font = '18px Arial';
  const bio = user.bio || 'Tidak ada bio';
  ctx.fillText(`📝 Bio: ${bio.substring(0, 30)}${bio.length > 30 ? '...' : ''}`, 280, 270);
  ctx.fillStyle = '#ffa94d';
  ctx.font = '18px Arial';
  const joinDate = user.join_date ? moment(user.join_date).format('DD MMMM YYYY') : 'Tidak diketahui';
  ctx.fillText(`📅 Join: ${joinDate}`, 280, 310);
  ctx.fillStyle = '#a29bfe';
  ctx.font = '18px Arial';
  ctx.fillText(`⭐ Status: ${user.isPremium ? '🟡 Premium' : '⚪ Free'}`, 280, 350);
  ctx.fillStyle = '#dfe6e9';
  ctx.font = '14px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(`Generated by ${config.BOT_NAME}`, 400, 480);
  ctx.fillStyle = '#636e72';
  ctx.fillText(moment().format('DD MMMM YYYY, HH:mm:ss'), 400, 460);
  
  return canvas.toBuffer();
}

// ============================================
// FUNGSI SEARCH MUSIC
// ============================================
async function searchMusic(query) {
  try {
    const results = await YouTube.search(query, { limit: 10 });
    return results.map(video => ({
      id: video.id,
      title: video.title,
      url: `https://youtube.com/watch?v=${video.id}`,
      duration: video.duration,
      views: video.views,
      thumbnail: video.thumbnail?.url || 'https://i.ytimg.com/vi/default.jpg',
      channel: video.channel?.name || 'Unknown'
    }));
  } catch (error) {
    return [];
  }
}

// ============================================
// FUNGSI DOWNLOAD YOUTUBE
// ============================================
async function downloadYouTube(url, format = 'mp3') {
  try {
    const info = await ytdl.getInfo(url);
    const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
    
    if (format === 'mp3') {
      const audioStream = ytdl(url, { quality: 'highestaudio', filter: 'audioonly' });
      const filePath = path.join(__dirname, `temp_${Date.now()}.mp3`);
      const writeStream = fs.createWriteStream(filePath);
      return new Promise((resolve, reject) => {
        audioStream.pipe(writeStream);
        writeStream.on('finish', () => resolve({ path: filePath, title }));
        writeStream.on('error', reject);
        audioStream.on('error', reject);
      });
    } else {
      const videoStream = ytdl(url, { quality: 'highestvideo', filter: 'videoandaudio' });
      const filePath = path.join(__dirname, `temp_${Date.now()}.mp4`);
      const writeStream = fs.createWriteStream(filePath);
      return new Promise((resolve, reject) => {
        videoStream.pipe(writeStream);
        writeStream.on('finish', () => resolve({ path: filePath, title }));
        writeStream.on('error', reject);
        videoStream.on('error', reject);
      });
    }
  } catch (error) {
    throw error;
  }
}

// ============================================
// INISIALISASI BOT
// ============================================
const bot = new Telegraf(config.BOT_TOKEN);

let isMaintenance = data.settings.isMaintenance || false;
let maintenanceMessage = data.settings.maintenanceMessage || config.MAINTENANCE_MESSAGE;
let antiToxicEnabled = data.settings.antiToxic || false;
let antiLinkEnabled = data.settings.antiLink || false;

bot.use(session({
  defaultSession: () => ({
    step: null,
    data: {},
    gameState: null,
    tempFiles: [],
    searchResults: [],
    currentPage: 0,
    lastMessageIds: [],
    broadcastData: null
  })
}));

// Load data dan init GitHub
loadData();
github.initRepo();

// ============================================
// MIDDLEWARE - MAINTENANCE
// ============================================
bot.use(async (ctx, next) => {
  const userId = ctx.from.id.toString();
  const isAdmin = await isUserAdmin(userId);
  
  if (isAdmin) return next();
  
  if (isMaintenance) {
    return ctx.reply(
      q(`🔧 *MAINTENANCE MODE*\n\n${maintenanceMessage}`),
      { parse_mode: 'HTML' }
    );
  }
  
  return next();
});

// ============================================
// MIDDLEWARE - CHECK AKSES
// ============================================
bot.use(async (ctx, next) => {
  const userId = ctx.from.id.toString();
  
  if (ctx.message?.text === '/start' || ctx.message?.text === '/add' || ctx.message?.text === '/cancel' ||
      ctx.message?.text === '/mute' || ctx.message?.text === '/unmute' || ctx.message?.text === '/muted' ||
      ctx.message?.text === '/ban' || ctx.message?.text === '/unban' || ctx.message?.text === '/backup' ||
      ctx.message?.text === '/cekid') {
    return next();
  }
  
  if (ctx.callbackQuery?.data === 'add_admin' || ctx.callbackQuery?.data === 'cancel_add_admin' || 
      ctx.callbackQuery?.data === 'mute_menu' || ctx.callbackQuery?.data === 'unmute_menu' || 
      ctx.callbackQuery?.data === 'backup_menu' || ctx.callbackQuery?.data === 'create_backup' ||
      ctx.callbackQuery?.data === 'list_github_files' || ctx.callbackQuery?.data === 'open_repo' ||
      ctx.callbackQuery?.data === 'restore_github' || ctx.callbackQuery?.data === 'confirm_restore') {
    return next();
  }
  
  const isAdmin = await isUserAdmin(userId);
  
  if (!isAdmin) {
    const joined = await isUserJoinedChannel(userId);
    if (!joined) {
      return ctx.replyWithVideo(
        config.START_VIDEO_URL,
        {
          caption: q(
            `⚠️ *WAJIB JOIN CHANNEL!*\n\n` +
            `Halo *${ctx.from.first_name}*! 👋\n\n` +
            `Kamu harus join channel kami terlebih dahulu untuk menggunakan bot ini.\n\n` +
            `📢 *Channel:* ${config.CHANNEL_ID}\n\n` +
            `✨ *Fitur yang akan kamu dapatkan:*\n` +
            `✅ 200+ Fitur Lengkap\n` +
            `✅ 100+ Game Seru\n` +
            `✅ HD Foto & Video\n` +
            `✅ Download Lagu\n` +
            `✅ Manajemen Grup Pro\n` +
            `✅ Anti Link & Toxic\n` +
            `✅ Mute/Unmute\n` +
            `✅ Backup & Restore\n` +
            `✅ Dan masih banyak lagi!`
          ),
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.url('📢 JOIN CHANNEL', config.CHANNEL_LINK)],
            [Markup.button.callback('✅ SUDAH JOIN', 'check_join')]
          ])
        }
      );
    }
  }
  
  return next();
});

// ============================================
// HANDLER CHECK JOIN
// ============================================
bot.action('check_join', async (ctx) => {
  try {
    const joined = await isUserJoinedChannel(ctx.from.id);
    if (!joined) {
      await ctx.answerCbQuery('❌ Kamu belum join channel!', { show_alert: true });
      return;
    }
    
    await ctx.answerCbQuery('✅ Terima kasih sudah join!');
    await deletePreviousMessages(ctx);
    await showMainMenu(ctx);
  } catch (error) {
    console.error('Check join error:', error);
    await ctx.answerCbQuery('❌ Terjadi error, coba lagi nanti!', { show_alert: true });
  }
});

// ============================================
// COMMAND /start
// ============================================
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  
  // Register user
  const existingUser = findUser(userId);
  if (!existingUser) {
    saveUser({
      userId: userId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      registeredAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      points: 0,
      isAdmin: false,
      isMuted: false,
      warns: 0
    });
  }
  
  const isAdmin = await isUserAdmin(userId);
  
  // Progress UI
  const progressMsg = await ctx.reply(
    await showProgress(ctx, 'Memulai Bot...', 0, 5, '🚀'),
    { parse_mode: 'HTML' }
  );
  
  for (let i = 1; i <= 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    await ctx.telegram.editMessageText(
      progressMsg.chat.id,
      progressMsg.message_id,
      null,
      await showProgress(ctx, 'Memulai Bot...', i, 5, '🚀'),
      { parse_mode: 'HTML' }
    );
  }
  
  await ctx.deleteMessage(progressMsg.message_id);
  
  if (isAdmin) {
    await ctx.replyWithVideo(
      config.START_VIDEO_URL,
      {
        caption: q(
          `🌟 *${config.BOT_NAME}*\n\n` +
          `👑 *Selamat datang ADMIN!*\n\n` +
          `Halo *${ctx.from.first_name}*! Anda memiliki akses penuh ke bot ini.\n\n` +
          `📌 *Fitur yang tersedia:*\n` +
          `• 200+ Fitur Lengkap\n` +
          `• 100+ Game Seru\n` +
          `• Manajemen Grup\n` +
          `• Mute/Unmute User\n` +
          `• Broadcast All Media\n` +
          `• Backup & Restore (GitHub)\n` +
          `• Maintenance Mode\n` +
          `• Anti Toxic & Anti Link\n` +
          `• Dan masih banyak lagi!\n\n` +
          `💡 Ketik /menu untuk mulai!`
        ),
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 MENU UTAMA', 'main_menu')],
          [Markup.button.callback('🎮 GAME CENTER', 'game_menu')],
          [Markup.button.callback('👥 MANAJEMEN GRUP', 'group_menu')],
          [Markup.button.callback('⚙️ ADMIN PANEL', 'admin_panel')]
        ])
      }
    );
  } else {
    const joined = await isUserJoinedChannel(userId);
    
    if (!joined) {
      return ctx.replyWithVideo(
        config.START_VIDEO_URL,
        {
          caption: q(
            `⚠️ *WAJIB JOIN CHANNEL!*\n\n` +
            `Halo *${ctx.from.first_name}*! 👋\n\n` +
            `Kamu harus join channel kami terlebih dahulu untuk menggunakan bot ini.\n\n` +
            `📢 *Channel:* ${config.CHANNEL_ID}\n\n` +
            `✨ *Fitur yang akan kamu dapatkan:*\n` +
            `✅ 200+ Fitur Lengkap\n` +
            `✅ 100+ Game Seru\n` +
            `✅ HD Foto & Video\n` +
            `✅ Download Lagu\n` +
            `✅ Manajemen Grup Pro\n` +
            `✅ Anti Link & Toxic\n` +
            `✅ Dan masih banyak lagi!`
          ),
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.url('📢 JOIN CHANNEL', config.CHANNEL_LINK)],
            [Markup.button.callback('✅ SUDAH JOIN', 'check_join')]
          ])
        }
      );
    }
    
    await showMainMenu(ctx);
  }
});

// ============================================
// MENU UTAMA
// ============================================
async function showMainMenu(ctx) {
  const user = findUser(ctx.from.id.toString());
  const isAdmin = await isUserAdmin(ctx.from.id.toString());
  const isOwner = ctx.from.id.toString() === config.OWNER_ID;
  
  const menuText = q(
    `🌟 *${config.BOT_NAME}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `👋 Halo *${ctx.from.first_name}*!\n\n` +
    `✨ *Selamat datang di bot premium dengan 200+ fitur & 100+ game!*\n\n` +
    `📊 *Info Akun:*\n` +
    `• 🆔 ID: ${ctx.from.id}\n` +
    `• ⭐ Status: ${isAdmin ? '🟡 Admin' : '⚪ User'}\n` +
    `• 🎯 Points: ${user?.points || 0}\n` +
    `• 📅 Bergabung: ${user?.registeredAt ? moment(user.registeredAt).format('DD/MM/YYYY') : 'Baru'}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 *Pilih menu di bawah ini:*\n`
  );
  
  const buttons = [
    [
      Markup.button.callback('🔧 TOOLS', 'tools_menu'),
      Markup.button.callback('👑 OWNER', 'owner_menu')
    ],
    [
      Markup.button.url('👤 OWNER', `https://t.me/${config.OWNER_USERNAME.replace('@', '')}`),
      Markup.button.url('📢 CHANNEL', config.CHANNEL_LINK)
    ]
  ];
  
  if (isAdmin) {
    buttons.push([Markup.button.callback('⚙️ ADMIN PANEL', 'admin_panel')]);
  }
  
  await deletePreviousMessages(ctx);
  const sent = await ctx.reply(
    menuText,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }
  );
  await saveMessageId(ctx, sent.message_id);
}

// ============================================
// TOOLS MENU
// ============================================
bot.action('tools_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const toolsText = q(
    `🔧 *TOOLS MENU*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Pilih tools yang ingin digunakan:*\n\n` +
    `🎮 *Game Center* - 100+ Game seru\n` +
    `📸 *HD Media* - Foto & Video berkualitas\n` +
    `🖼️ *Foto ke URL* - Upload ke Catbox\n` +
    `🎵 *Download Lagu* - Cari & download\n` +
    `👥 *Manajemen Grup* - Kelola grup\n` +
    `🛡️ *Anti Link & Toxic* - Proteksi grup\n` +
    `🔇 *Mute/Unmute* - Kelola mute user\n` +
    `📊 *Cek ID* - Info user dengan canvas\n` +
    `💾 *Backup & Restore* - Backup ke GitHub\n` +
    `🔧 *Fitur Lainnya* - Fitur tambahan\n`
  );
  
  const buttons = [
    [Markup.button.callback('🎮 GAME CENTER (100+)', 'game_menu')],
    [Markup.button.callback('📸 HD FOTO & VIDEO', 'hd_media_menu')],
    [Markup.button.callback('🖼️ FOTO KE URL', 'photo_to_url')],
    [Markup.button.callback('🎵 DOWNLOAD LAGU', 'music_menu')],
    [Markup.button.callback('👥 MANAJEMEN GRUP', 'group_menu')],
    [Markup.button.callback('🛡️ ANTI LINK & TOXIC', 'anti_menu')],
    [Markup.button.callback('🔇 MUTE/UNMUTE', 'mute_menu')],
    [Markup.button.callback('📊 CEK ID (CANVAS)', 'cek_id_menu')],
    [Markup.button.callback('💾 BACKUP & RESTORE', 'backup_menu')],
    [Markup.button.callback('🔧 FITUR LAINNYA', 'other_features')],
    [Markup.button.callback('🔙 KEMBALI KE MENU', 'main_menu')]
  ];
  
  const sent = await ctx.reply(
    toolsText,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// BACKUP MENU
// ============================================
bot.action('backup_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const isAdmin = await isUserAdmin(ctx.from.id.toString());
  if (!isAdmin) {
    return ctx.reply(q(`❌ Hanya admin yang bisa mengakses menu ini!`), { parse_mode: 'HTML' });
  }
  
  const repoUrl = github.getRepoUrl();
  const files = await github.listFiles();
  
  let fileList = '';
  if (files.length > 0) {
    files.slice(0, 5).forEach(file => {
      fileList += `• [${file.name}](${file.repoUrl})\n`;
    });
    if (files.length > 5) {
      fileList += `• ... dan ${files.length - 5} file lainnya\n`;
    }
  } else {
    fileList = 'Belum ada file di GitHub';
  }
  
  const text = q(
    `💾 *BACKUP & RESTORE MENU (GITHUB)*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *GitHub Repository:*\n` +
    `🔗 ${repoUrl}\n\n` +
    `📌 *File yang tersimpan:*\n` +
    `${fileList}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Fitur:*\n\n` +
    `🔹 *Backup* - Backup semua file ke GitHub\n` +
    `🔹 *Restore* - Restore data dari GitHub\n\n` +
    `💡 Semua file akan otomatis tersimpan di GitHub\n` +
    `🔗 Link URL akan muncul setelah backup`
  );
  
  const buttons = [
    [Markup.button.callback('💾 BUAT BACKUP SEKARANG', 'create_backup')],
    [Markup.button.callback('📋 LIST FILE GITHUB', 'list_github_files')],
    [Markup.button.callback('🔄 RESTORE DARI GITHUB', 'restore_github')],
    [Markup.button.callback('🔗 BUKA REPO', 'open_repo')],
    [Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]
  ];
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard(buttons)
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// CREATE BACKUP
// ============================================
bot.action('create_backup', async (ctx) => {
  await ctx.answerCbQuery('⏳ Membuat backup...', { show_alert: true });
  await deletePreviousMessages(ctx);
  
  const progressMsg = await ctx.reply(
    await showProgress(ctx, 'Membuat Backup ke GitHub...', 0, 5, '💾'),
    { parse_mode: 'HTML' }
  );
  
  for (let i = 1; i <= 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 600));
    await ctx.telegram.editMessageText(
      progressMsg.chat.id,
      progressMsg.message_id,
      null,
      await showProgress(ctx, 'Membuat Backup ke GitHub...', i, 5, '💾'),
      { parse_mode: 'HTML' }
    );
  }
  
  await ctx.deleteMessage(progressMsg.message_id);
  
  try {
    await saveData();
    const results = await github.createFullBackup();
    
    let fileUrls = '';
    for (const [key, value] of Object.entries(results.files)) {
      if (value && value.url) {
        fileUrls += `• 📄 [${key}](${value.repoUrl})\n`;
      }
    }
    
    await ctx.reply(
      q(
        `✅ *BACKUP BERHASIL!*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📌 *GitHub Repository:*\n` +
        `🔗 ${results.repoUrl}\n\n` +
        `📌 *File yang diupload:*\n` +
        `${fileUrls}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📅 *Waktu:* ${results.timestamp}\n` +
        `💡 Semua file tersimpan di GitHub!\n` +
        `🔗 Klik link di atas untuk melihat file.`
      ),
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([
          [Markup.button.url('🔗 BUKA REPO', results.repoUrl)],
          [Markup.button.callback('📋 LIST FILE', 'list_github_files')],
          [Markup.button.callback('🔙 KEMBALI KE BACKUP MENU', 'backup_menu')]
        ])
      }
    );
    
  } catch (error) {
    console.error('Backup error:', error);
    await ctx.reply(
      q(`❌ *Gagal membuat backup!*\n\n${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
});

// ============================================
// LIST GITHUB FILES
// ============================================
bot.action('list_github_files', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  try {
    const files = await github.listFiles();
    
    if (files.length === 0) {
      return ctx.reply(
        q(`📋 *Tidak ada file di GitHub*\n\nBelum ada file yang diupload.`),
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 KEMBALI KE BACKUP MENU', 'backup_menu')]
          ])
        }
      );
    }
    
    let fileList = q(
      `📋 *FILE DI GITHUB*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📌 *Repository:* ${github.getRepoUrl()}\n\n`
    );
    
    files.forEach((file, index) => {
      fileList += `${index + 1}. 📄 *${file.name}*\n`;
      fileList += `   📦 Size: ${(file.size / 1024).toFixed(2)} KB\n`;
      fileList += `   🔗 [URL](${file.repoUrl})\n\n`;
    });
    
    await ctx.reply(
      fileList,
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 REFRESH', 'list_github_files')],
          [Markup.button.callback('🔙 KEMBALI KE BACKUP MENU', 'backup_menu')]
        ])
      }
    );
    
  } catch (error) {
    console.error('List files error:', error);
    await ctx.reply(
      q(`❌ *Gagal mengambil daftar file!*\n\n${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
});

// ============================================
// OPEN REPO
// ============================================
bot.action('open_repo', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    q(
      `🔗 *BUKA REPOSITORY GITHUB*\n\n` +
      `Klik tombol di bawah untuk membuka repo:\n\n` +
      `${github.getRepoUrl()}`
    ),
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🔗 BUKA GITHUB REPO', github.getRepoUrl())],
        [Markup.button.callback('🔙 KEMBALI KE BACKUP MENU', 'backup_menu')]
      ])
    }
  );
});

// ============================================
// RESTORE DARI GITHUB
// ============================================
bot.action('restore_github', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const isAdmin = await isUserAdmin(ctx.from.id.toString());
  if (!isAdmin) {
    return ctx.reply(q(`❌ Hanya admin!`), { parse_mode: 'HTML' });
  }
  
  const text = q(
    `🔄 *RESTORE DARI GITHUB*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `⚠️ *Peringatan:*\n` +
    `• Restore akan mengambil data terakhir dari GitHub\n` +
    `• Data lokal akan diganti dengan data dari GitHub\n` +
    `• Pastikan koneksi internet stabil\n\n` +
    `📌 Klik tombol di bawah untuk restore:`
  );
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ RESTORE SEKARANG', 'confirm_restore')],
        [Markup.button.callback('🔙 KEMBALI KE BACKUP MENU', 'backup_menu')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

bot.action('confirm_restore', async (ctx) => {
  await ctx.answerCbQuery('⏳ Restoring...', { show_alert: true });
  await deletePreviousMessages(ctx);
  
  const progressMsg = await ctx.reply(
    await showProgress(ctx, 'Restore dari GitHub...', 0, 3, '🔄'),
    { parse_mode: 'HTML' }
  );
  
  for (let i = 1; i <= 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    await ctx.telegram.editMessageText(
      progressMsg.chat.id,
      progressMsg.message_id,
      null,
      await showProgress(ctx, 'Restore dari GitHub...', i, 3, '🔄'),
      { parse_mode: 'HTML' }
    );
  }
  
  await ctx.deleteMessage(progressMsg.message_id);
  
  try {
    // Download data dari GitHub
    const githubData = await github.downloadData();
    
    if (githubData) {
      data = githubData;
      saveData();
      
      isMaintenance = data.settings.isMaintenance || false;
      maintenanceMessage = data.settings.maintenanceMessage || config.MAINTENANCE_MESSAGE;
      antiToxicEnabled = data.settings.antiToxic || false;
      antiLinkEnabled = data.settings.antiLink || false;
      
      await ctx.reply(
        q(
          `✅ *RESTORE BERHASIL!*\n\n` +
          `Data berhasil direstore dari GitHub.\n\n` +
          `📊 *Statistik:*\n` +
          `• Users: ${data.users.length}\n` +
          `• Groups: ${data.groups.length}\n` +
          `• Admins: ${data.admins.length}\n` +
          `• Mute Logs: ${data.muteLogs.length}\n\n` +
          `📅 Waktu: ${moment().format('DD MMMM YYYY, HH:mm:ss')}`
        ),
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 KEMBALI KE BACKUP MENU', 'backup_menu')]
          ])
        }
      );
    } else {
      await ctx.reply(
        q(`❌ *Gagal restore!*\n\nTidak ada data di GitHub.`),
        { parse_mode: 'HTML' }
      );
    }
    
  } catch (error) {
    console.error('Restore error:', error);
    await ctx.reply(
      q(`❌ *Gagal restore!*\n\n${error.message}`),
      { parse_mode: 'HTML' }
    );
  }
});

// ============================================
// ADMIN PANEL
// ============================================
bot.action('admin_panel', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const isAdmin = await isUserAdmin(ctx.from.id.toString());
  if (!isAdmin) {
    return ctx.reply(q(`❌ Akses ditolak! Hanya admin.`), { parse_mode: 'HTML' });
  }
  
  const mutedCount = data.users.filter(u => u.isMuted).length;
  
  const statusText = q(
    `⚙️ *ADMIN PANEL*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Status Bot:*\n` +
    `• 🔧 Maintenance: ${isMaintenance ? '✅ AKTIF' : '❌ NONAKTIF'}\n` +
    `• 🛡️ Anti Toxic: ${antiToxicEnabled ? '✅ AKTIF' : '❌ NONAKTIF'}\n` +
    `• 🔗 Anti Link: ${antiLinkEnabled ? '✅ AKTIF' : '❌ NONAKTIF'}\n` +
    `• 🔇 Muted Users: ${mutedCount}\n` +
    `• 💾 Backup: ${github.getRepoUrl()}\n\n` +
    `📌 *Pilih menu:*\n`
  );
  
  const buttons = [
    [Markup.button.callback('🔧 MAINTENANCE', 'maintenance_menu')],
    [Markup.button.callback('🛡️ ANTI TOXIC', 'anti_toxic_toggle')],
    [Markup.button.callback('🔗 ANTI LINK', 'anti_link_toggle')],
    [Markup.button.callback('🔇 MUTE MANAGEMENT', 'mute_menu')],
    [Markup.button.callback('💾 BACKUP & RESTORE', 'backup_menu')],
    [Markup.button.callback('📢 BROADCAST', 'broadcast_menu')],
    [Markup.button.callback('📊 STATISTIK', 'stats_menu')],
    [Markup.button.callback('🔙 KEMBALI KE MENU', 'main_menu')]
  ];
  
  const sent = await ctx.reply(
    statusText,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// MAINTENANCE MENU
// ============================================
bot.action('maintenance_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const text = q(
    `🔧 *MAINTENANCE MENU*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Status:* ${isMaintenance ? '✅ AKTIF' : '❌ NONAKTIF'}\n\n` +
    `💡 *Pesan Maintenance Saat Ini:*\n` +
    `"${maintenanceMessage}"\n\n` +
    `📌 *Pilih aksi:*\n`
  );
  
  const buttons = [
    [Markup.button.callback(
      isMaintenance ? '❌ MATIKAN MAINTENANCE' : '✅ AKTIFKAN MAINTENANCE',
      'toggle_maintenance'
    )],
    [Markup.button.callback('✏️ SET PESAN MAINTENANCE', 'set_maintenance_message')],
    [Markup.button.callback('🔙 KEMBALI KE ADMIN PANEL', 'admin_panel')]
  ];
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

bot.action('toggle_maintenance', async (ctx) => {
  await ctx.answerCbQuery();
  isMaintenance = !isMaintenance;
  data.settings.isMaintenance = isMaintenance;
  await saveData();
  await deletePreviousMessages(ctx);
  await ctx.action('maintenance_menu');
});

bot.action('set_maintenance_message', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.step = 'waiting_maintenance_message';
  
  const sent = await ctx.reply(
    q(
      `✏️ *SET PESAN MAINTENANCE*\n\n` +
      `Kirimkan pesan maintenance baru.\n\n` +
      `💡 *Contoh:*\n` +
      `"Bot sedang dalam perbaikan. Akan kembali dalam 30 menit!"\n\n` +
      `⏹️ Ketik /cancel untuk membatalkan.`
    ),
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI', 'maintenance_menu')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// ANTI TOXIC TOGGLE
// ============================================
bot.action('anti_toxic_toggle', async (ctx) => {
  await ctx.answerCbQuery();
  antiToxicEnabled = !antiToxicEnabled;
  data.settings.antiToxic = antiToxicEnabled;
  await saveData();
  
  const status = antiToxicEnabled ? '✅ AKTIF' : '❌ NONAKTIF';
  await deletePreviousMessages(ctx);
  
  const sent = await ctx.reply(
    q(
      `🛡️ *ANTI TOXIC*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📌 Status: ${status}\n\n` +
      `💡 Fitur ini akan memblokir pesan toxic di grup.\n\n` +
      `📌 *Kata-kata yang diblokir:*\n` +
      `${config.DEFAULT_FILTER_WORDS.join(', ')}`
    ),
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE ADMIN PANEL', 'admin_panel')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// ANTI LINK TOGGLE
// ============================================
bot.action('anti_link_toggle', async (ctx) => {
  await ctx.answerCbQuery();
  antiLinkEnabled = !antiLinkEnabled;
  data.settings.antiLink = antiLinkEnabled;
  await saveData();
  
  const status = antiLinkEnabled ? '✅ AKTIF' : '❌ NONAKTIF';
  await deletePreviousMessages(ctx);
  
  const sent = await ctx.reply(
    q(
      `🔗 *ANTI LINK*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📌 Status: ${status}\n\n` +
      `💡 Fitur ini akan memblokir pesan yang mengandung link di grup.\n\n` +
      `📌 *Link yang diblokir:*\n` +
      `• t.me/*\n` +
      `• http://*\n` +
      `• https://*\n` +
      `• www.*`
    ),
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE ADMIN PANEL', 'admin_panel')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// STATS MENU
// ============================================
bot.action('stats_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const totalUsers = data.users.length;
  const totalAdmins = data.admins.length;
  const totalGroups = data.groups.length;
  const mutedCount = data.users.filter(u => u.isMuted).length;
  
  const text = q(
    `📊 *STATISTIK BOT*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *User:*\n` +
    `• Total User: ${totalUsers}\n` +
    `• Total Admin: ${totalAdmins}\n` +
    `• Muted Users: ${mutedCount}\n\n` +
    `📌 *Grup:*\n` +
    `• Total Grup: ${totalGroups}\n\n` +
    `📌 *Bot:*\n` +
    `• Nama: ${config.BOT_NAME}\n` +
    `• Versi: ${config.BOT_VERSION}\n` +
    `• Status: ${isMaintenance ? '🔧 Maintenance' : '✅ Online'}\n\n` +
    `📌 *Anti Features:*\n` +
    `• Anti Toxic: ${antiToxicEnabled ? '✅' : '❌'}\n` +
    `• Anti Link: ${antiLinkEnabled ? '✅' : '❌'}\n\n` +
    `📌 *GitHub Backup:*\n` +
    `• Repo: ${github.getRepoUrl()}`
  );
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE ADMIN PANEL', 'admin_panel')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// BROADCAST MENU
// ============================================
bot.action('broadcast_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const text = q(
    `📢 *BROADCAST MENU*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Kirim pesan ke semua pengguna bot*\n\n` +
    `💡 *Cara Penggunaan:*\n\n` +
    `1️⃣ Kirimkan pesan (text, photo, video, audio, document)\n` +
    `2️⃣ Bot akan mengirim ke semua user yang terdaftar\n` +
    `3️⃣ Tunggu hingga proses selesai\n\n` +
    `⚠️ *Peringatan:*\n` +
    `• Broadcast akan dikirim ke SEMUA user\n` +
    `• Proses bisa memakan waktu lama\n` +
    `• Gunakan dengan bijak!\n\n` +
    `📌 Kirim pesan broadcast sekarang!`
  );
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE ADMIN PANEL', 'admin_panel')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
  ctx.session.step = 'waiting_broadcast';
});

// ============================================
// MUTE MENU
// ============================================
bot.action('mute_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const isAdmin = await isUserAdmin(ctx.from.id.toString());
  if (!isAdmin) {
    return ctx.reply(q(`❌ Hanya admin yang bisa mengakses menu ini!`), { parse_mode: 'HTML' });
  }
  
  const mutedCount = data.users.filter(u => u.isMuted).length;
  
  const text = q(
    `🔇 *MUTE MANAGEMENT*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Status:*\n` +
    `• Total Muted: ${mutedCount} user\n\n` +
    `📌 *Cara Penggunaan:*\n\n` +
    `🔹 *Mute User:*\n` +
    `• Reply pesan user: /mute 1d alasan\n` +
    `• Atau: /mute ID 1d alasan\n\n` +
    `🔹 *Unmute User:*\n` +
    `• Reply pesan user: /unmute\n` +
    `• Atau: /unmute ID\n\n` +
    `🔹 *Lihat Daftar Mute:*\n` +
    `• Kirim /muted\n\n` +
    `📌 *Format Duration:*\n` +
    `• s = detik (30s)\n` +
    `• m = menit (5m)\n` +
    `• h = jam (2h)\n` +
    `• d = hari (1d)\n` +
    `• M = bulan (1M)\n` +
    `• y = tahun (1y)`
  );
  
  const buttons = [
    [Markup.button.callback('📊 LIHAT MUTED USERS', 'view_muted')],
    [Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]
  ];
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

bot.action('view_muted', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const mutedUsers = data.users.filter(u => u.isMuted);
  
  if (mutedUsers.length === 0) {
    const sent = await ctx.reply(
      q(`📊 *Tidak ada user yang di-mute*`),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 KEMBALI KE MUTE MENU', 'mute_menu')]
        ])
      }
    );
    await saveMessageId(ctx, sent.message_id);
    return;
  }
  
  let list = q(
    `🔇 *DAFTAR USER DI-MUTE*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`
  );
  
  mutedUsers.forEach((user, index) => {
    const remaining = moment(user.mutedUntil).fromNow();
    list += `${index + 1}. 👤 ${user.firstName || user.userId}\n`;
    list += `   🆔 ID: ${user.userId}\n`;
    list += `   ⏳ Sisa: ${remaining}\n`;
    list += `   📌 Alasan: ${user.mutedReason || 'Tidak ada'}\n`;
    list += `   📅 Sampai: ${moment(user.mutedUntil).format('DD/MM/YYYY HH:mm')}\n\n`;
  });
  
  list += `\n💡 Gunakan /unmute [ID] untuk membuka mute.`;
  
  const buttons = [];
  mutedUsers.slice(0, 5).forEach((user) => {
    buttons.push([
      Markup.button.callback(
        `🔊 Unmute ${user.firstName || user.userId}`,
        `unmute_user_${user.userId}`
      )
    ]);
  });
  buttons.push([Markup.button.callback('🔙 KEMBALI KE MUTE MENU', 'mute_menu')]);
  
  const sent = await ctx.reply(
    list,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// Handler unmute via button
bot.action(/unmute_user_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const targetId = ctx.match[1];
  
  const isAdmin = await isUserAdmin(ctx.from.id.toString());
  if (!isAdmin) {
    return ctx.reply(q(`❌ Hanya admin yang bisa unmute!`), { parse_mode: 'HTML' });
  }
  
  const userIndex = data.users.findIndex(u => u.userId === targetId);
  if (userIndex === -1 || !data.users[userIndex].isMuted) {
    return ctx.reply(q(`⚠️ User tidak dalam keadaan mute!`), { parse_mode: 'HTML' });
  }
  
  data.users[userIndex].isMuted = false;
  data.users[userIndex].mutedUntil = null;
  await saveData();
  
  await ctx.reply(
    q(
      `🔊 *USER DI-UNMUTE!*\n\n` +
      `👤 *User:* ${data.users[userIndex].firstName || targetId}\n` +
      `🆔 *ID:* ${targetId}\n` +
      `👑 *Diunmute oleh:* ${ctx.from.first_name}\n\n` +
      `✅ User sekarang bisa chat kembali!`
    ),
    { parse_mode: 'HTML' }
  );
  
  try {
    await bot.telegram.sendMessage(
      targetId,
      q(
        `🔊 *KAMU DI-UNMUTE!*\n\n` +
        `Mute kamu telah dibuka oleh admin.\n\n` +
        `✅ Kamu sekarang bisa chat kembali!\n` +
        `👑 Diunmute oleh: ${ctx.from.first_name}`
      ),
      { parse_mode: 'HTML' }
    );
  } catch (error) {}
  
  await deletePreviousMessages(ctx);
  await ctx.action('view_muted');
});

// ============================================
// COMMAND /mute
// ============================================
bot.command('mute', async (ctx) => {
  const userId = ctx.from.id.toString();
  const isAdmin = await isUserAdmin(userId);
  const isBotAdmin = await isBotAdminInGroup(ctx.chat.id);
  
  if (!isAdmin) {
    return ctx.reply(q(`❌ Hanya admin yang bisa mute!`), { parse_mode: 'HTML' });
  }
  
  if (!isBotAdmin) {
    return ctx.reply(q(`❌ Bot harus menjadi admin di grup ini!`), { parse_mode: 'HTML' });
  }
  
  let targetId;
  let duration = '1d';
  let reason = 'Tidak ada alasan';
  let args = ctx.message.text.split(' ');
  
  if (ctx.message.reply_to_message) {
    targetId = ctx.message.reply_to_message.from.id;
    args = args.slice(1);
  } else {
    if (args.length < 2) {
      return ctx.reply(
        q(
          `📌 *Cara Mute User*\n\n` +
          `1️⃣ Reply pesan user: /mute 1d alasannya\n` +
          `2️⃣ Atau kirim: /mute ID 1d alasannya\n\n` +
          `📌 *Format Duration:*\n` +
          `• s = detik (contoh: 30s)\n` +
          `• m = menit (contoh: 5m)\n` +
          `• h = jam (contoh: 2h)\n` +
          `• d = hari (contoh: 1d)\n` +
          `• M = bulan (contoh: 1M)\n` +
          `• y = tahun (contoh: 1y)\n\n` +
          `💡 *Contoh:*\n` +
          `/mute 123456789 7d Spam\n` +
          `Atau reply pesan: /mute 1h Kirim link`
        ),
        { parse_mode: 'HTML' }
      );
    }
    
    targetId = args[1];
    if (!/^\d+$/.test(targetId)) {
      return ctx.reply(q(`❌ ID tidak valid!`), { parse_mode: 'HTML' });
    }
    args = args.slice(2);
  }
  
  if (args.length > 0 && /^\d+[dhmsMy]$/.test(args[0])) {
    duration = args[0];
    args = args.slice(1);
  }
  
  if (args.length > 0) {
    reason = args.join(' ');
  }
  
  const durationMs = parseDuration(duration);
  if (!durationMs) {
    return ctx.reply(
      q(
        `❌ *Format duration salah!*\n\n` +
        `Gunakan format: 30s, 5m, 2h, 1d, 1M, 1y\n\n` +
        `Contoh: /mute 123456789 7d Spam`
      ),
      { parse_mode: 'HTML' }
    );
  }
  
  const isTargetAdmin = await isUserAdmin(targetId.toString());
  if (isTargetAdmin) {
    return ctx.reply(q(`❌ Tidak bisa mute admin!`), { parse_mode: 'HTML' });
  }
  
  let targetUser = findUser(targetId.toString());
  if (!targetUser) {
    targetUser = {
      userId: targetId.toString(),
      firstName: 'Unknown',
      username: 'Unknown',
      isMuted: false,
      mutedUntil: null,
      mutedReason: '',
      mutedBy: ''
    };
    saveUser(targetUser);
  }
  
  if (targetUser.isMuted && targetUser.mutedUntil && new Date() < new Date(targetUser.mutedUntil)) {
    return ctx.reply(
      q(
        `⚠️ *User sudah dalam keadaan mute!*\n\n` +
        `Sisa waktu: ${moment(targetUser.mutedUntil).fromNow()}\n` +
        `Alasan: ${targetUser.mutedReason || 'Tidak ada alasan'}`
      ),
      { parse_mode: 'HTML' }
    );
  }
  
  const mutedUntil = new Date(Date.now() + durationMs);
  targetUser.isMuted = true;
  targetUser.mutedUntil = mutedUntil.toISOString();
  targetUser.mutedReason = reason;
  targetUser.mutedBy = userId;
  saveUser(targetUser);
  
  // Save log
  if (!data.muteLogs) data.muteLogs = [];
  data.muteLogs.push({
    userId: targetId.toString(),
    username: ctx.message.reply_to_message?.from?.username || 'Unknown',
    firstName: ctx.message.reply_to_message?.from?.first_name || 'Unknown',
    mutedBy: userId,
    mutedByUsername: ctx.from.username || ctx.from.first_name,
    mutedAt: new Date().toISOString(),
    mutedUntil: mutedUntil.toISOString(),
    reason: reason,
    status: 'active'
  });
  await saveData();
  
  await ctx.reply(
    q(
      `🔇 *USER DI-MUTE!*\n\n` +
      `👤 *User:* ${ctx.message.reply_to_message?.from?.first_name || targetId} (@${ctx.message.reply_to_message?.from?.username || 'Tidak ada'})\n` +
      `🆔 *ID:* ${targetId}\n` +
      `⏰ *Durasi:* ${duration}\n` +
      `📅 *Sampai:* ${moment(mutedUntil).format('DD MMMM YYYY, HH:mm:ss')}\n` +
      `📌 *Alasan:* ${reason}\n` +
      `👑 *Dimute oleh:* ${ctx.from.first_name}\n\n` +
      `💡 Ketik /unmute ${targetId} untuk membuka mute.`
    ),
    { parse_mode: 'HTML' }
  );
  
  try {
    await bot.telegram.sendMessage(
      targetId,
      q(
        `🔇 *KAMU DI-MUTE!*\n\n` +
        `Kamu telah di-mute oleh admin.\n\n` +
        `📌 *Detail:*\n` +
        `• Durasi: ${duration}\n` +
        `• Sampai: ${moment(mutedUntil).format('DD MMMM YYYY, HH:mm:ss')}\n` +
        `• Alasan: ${reason}\n` +
        `• Oleh: ${ctx.from.first_name}\n\n` +
        `⏳ Tunggu hingga masa mute selesai.`
      ),
      { parse_mode: 'HTML' }
    );
  } catch (error) {}
});

// ============================================
// COMMAND /unmute
// ============================================
bot.command('unmute', async (ctx) => {
  const userId = ctx.from.id.toString();
  const isAdmin = await isUserAdmin(userId);
  const isBotAdmin = await isBotAdminInGroup(ctx.chat.id);
  
  if (!isAdmin) {
    return ctx.reply(q(`❌ Hanya admin yang bisa unmute!`), { parse_mode: 'HTML' });
  }
  
  if (!isBotAdmin) {
    return ctx.reply(q(`❌ Bot harus menjadi admin di grup ini!`), { parse_mode: 'HTML' });
  }
  
  let targetId;
  const args = ctx.message.text.split(' ');
  
  if (ctx.message.reply_to_message) {
    targetId = ctx.message.reply_to_message.from.id;
  } else {
    if (args.length < 2) {
      return ctx.reply(
        q(
          `📌 *Cara Unmute User*\n\n` +
          `1️⃣ Reply pesan user: /unmute\n` +
          `2️⃣ Atau kirim: /unmute ID\n\n` +
          `Contoh: /unmute 123456789`
        ),
        { parse_mode: 'HTML' }
      );
    }
    targetId = args[1];
    if (!/^\d+$/.test(targetId)) {
      return ctx.reply(q(`❌ ID tidak valid!`), { parse_mode: 'HTML' });
    }
  }
  
  const targetUser = findUser(targetId.toString());
  if (!targetUser || !targetUser.isMuted) {
    return ctx.reply(q(`⚠️ User tidak dalam keadaan mute!`), { parse_mode: 'HTML' });
  }
  
  targetUser.isMuted = false;
  targetUser.mutedUntil = null;
  saveUser(targetUser);
  
  // Update log
  if (data.muteLogs) {
    const logIndex = data.muteLogs.findIndex(l => l.userId === targetId.toString() && l.status === 'active');
    if (logIndex !== -1) {
      data.muteLogs[logIndex].status = 'unmuted';
      data.muteLogs[logIndex].unmutedAt = new Date().toISOString();
      await saveData();
    }
  }
  
  await ctx.reply(
    q(
      `🔊 *USER DI-UNMUTE!*\n\n` +
      `👤 *User:* ${targetUser.firstName || targetId} (@${targetUser.username || 'Tidak ada'})\n` +
      `🆔 *ID:* ${targetId}\n` +
      `👑 *Diunmute oleh:* ${ctx.from.first_name}\n\n` +
      `✅ User sekarang bisa chat kembali!`
    ),
    { parse_mode: 'HTML' }
  );
  
  try {
    await bot.telegram.sendMessage(
      targetId,
      q(
        `🔊 *KAMU DI-UNMUTE!*\n\n` +
        `Mute kamu telah dibuka oleh admin.\n\n` +
        `✅ Kamu sekarang bisa chat kembali!\n` +
        `👑 Diunmute oleh: ${ctx.from.first_name}`
      ),
      { parse_mode: 'HTML' }
    );
  } catch (error) {}
});

// ============================================
// COMMAND /muted
// ============================================
bot.command('muted', async (ctx) => {
  const userId = ctx.from.id.toString();
  const isAdmin = await isUserAdmin(userId);
  
  if (!isAdmin) {
    return ctx.reply(q(`❌ Hanya admin yang bisa melihat daftar mute!`), { parse_mode: 'HTML' });
  }
  
  const mutedUsers = data.users.filter(u => u.isMuted);
  
  if (mutedUsers.length === 0) {
    return ctx.reply(q(`📊 *Tidak ada user yang di-mute*`), { parse_mode: 'HTML' });
  }
  
  let list = q(
    `🔇 *DAFTAR USER DI-MUTE*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`
  );
  
  mutedUsers.forEach((user, index) => {
    const remaining = moment(user.mutedUntil).fromNow();
    list += `${index + 1}. 👤 ${user.firstName || user.userId}\n`;
    list += `   🆔 ID: ${user.userId}\n`;
    list += `   ⏳ Sisa: ${remaining}\n`;
    list += `   📌 Alasan: ${user.mutedReason || 'Tidak ada'}\n`;
    list += `   📅 Sampai: ${moment(user.mutedUntil).format('DD/MM/YYYY HH:mm')}\n\n`;
  });
  
  list += `\n💡 Gunakan /unmute [ID] untuk membuka mute.`;
  
  await ctx.reply(
    list,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE MENU', 'main_menu')]
      ])
    }
  );
});

// ============================================
// BROADCAST HANDLER
// ============================================
bot.on(['text', 'photo', 'video', 'audio', 'document'], async (ctx) => {
  if (ctx.session.step === 'waiting_broadcast') {
    const isAdmin = await isUserAdmin(ctx.from.id.toString());
    if (!isAdmin) {
      ctx.session.step = null;
      return ctx.reply(q(`❌ Hanya admin yang bisa broadcast!`), { parse_mode: 'HTML' });
    }
    
    const users = getUsers();
    
    if (users.length === 0) {
      return ctx.reply(q(`❌ Tidak ada user yang terdaftar!`), { parse_mode: 'HTML' });
    }
    
    const progressMsg = await ctx.reply(
      await showProgress(ctx, 'Mengirim Broadcast...', 0, users.length, '📢'),
      { parse_mode: 'HTML' }
    );
    
    let sent = 0;
    let failed = 0;
    
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      try {
        if (ctx.message.text) {
          await bot.telegram.sendMessage(user.userId, ctx.message.text, { parse_mode: 'HTML' });
        } else if (ctx.message.photo) {
          const photo = ctx.message.photo[ctx.message.photo.length - 1];
          await bot.telegram.sendPhoto(user.userId, photo.file_id, {
            caption: ctx.message.caption || '',
            parse_mode: 'HTML'
          });
        } else if (ctx.message.video) {
          await bot.telegram.sendVideo(user.userId, ctx.message.video.file_id, {
            caption: ctx.message.caption || '',
            parse_mode: 'HTML'
          });
        } else if (ctx.message.audio) {
          await bot.telegram.sendAudio(user.userId, ctx.message.audio.file_id, {
            caption: ctx.message.caption || '',
            parse_mode: 'HTML',
            title: ctx.message.audio.title || 'Audio'
          });
        } else if (ctx.message.document) {
          await bot.telegram.sendDocument(user.userId, ctx.message.document.file_id, {
            caption: ctx.message.caption || '',
            parse_mode: 'HTML'
          });
        }
        sent++;
      } catch (error) {
        failed++;
      }
      
      if (i % 5 === 0 || i === users.length - 1) {
        await ctx.telegram.editMessageText(
          progressMsg.chat.id,
          progressMsg.message_id,
          null,
          await showProgress(ctx, 'Mengirim Broadcast...', i + 1, users.length, '📢'),
          { parse_mode: 'HTML' }
        );
      }
    }
    
    await ctx.deleteMessage(progressMsg.message_id);
    ctx.session.step = null;
    
    await ctx.reply(
      q(
        `✅ *Broadcast Selesai!*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 *Statistik:*\n` +
        `• Total User: ${users.length}\n` +
        `• ✅ Berhasil: ${sent}\n` +
        `• ❌ Gagal: ${failed}\n` +
        `• 📅 Waktu: ${moment().format('DD MMM YYYY, HH:mm:ss')}`
      ),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📢 BROADCAST LAGI', 'broadcast_menu')],
          [Markup.button.callback('🔙 KEMBALI KE ADMIN PANEL', 'admin_panel')]
        ])
      }
    );
  }
});

// ============================================
// HANDLER SET MAINTENANCE MESSAGE
// ============================================
bot.on('text', async (ctx) => {
  if (ctx.session.step === 'waiting_maintenance_message' && ctx.message.text !== '/cancel') {
    maintenanceMessage = ctx.message.text;
    data.settings.maintenanceMessage = maintenanceMessage;
    await saveData();
    ctx.session.step = null;
    
    await deletePreviousMessages(ctx);
    const sent = await ctx.reply(
      q(
        `✅ *Pesan Maintenance Diperbarui!*\n\n` +
        `📌 Pesan baru:\n` +
        `"${maintenanceMessage}"`
      ),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔙 KEMBALI KE MAINTENANCE', 'maintenance_menu')]
        ])
      }
    );
    await saveMessageId(ctx, sent.message_id);
  }
});

// ============================================
// COMMAND /add - TAMBAH ADMIN
// ============================================
bot.command('add', async (ctx) => {
  const userId = ctx.from.id.toString();
  
  if (userId !== config.OWNER_ID) {
    return ctx.reply(
      q(
        `❌ *Akses Ditolak!*\n\n` +
        `Hanya *OWNER* yang bisa menambah admin.\n\n` +
        `👑 Owner: ${config.OWNER_USERNAME}`
      ),
      { parse_mode: 'HTML' }
    );
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply(
      q(
        `📌 *Cara Menambah Admin*\n\n` +
        `Kirim ID user yang ingin dijadikan admin.\n\n` +
        `Contoh: /add 123456789\n\n` +
        `💡 *Cara dapat ID:*\n` +
        `• Forward pesan ke @userinfobot\n` +
        `• Atau gunakan command /cekid`
      ),
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📊 CEK ID', 'cek_id_menu')],
          [Markup.button.callback('🔙 KEMBALI', 'main_menu')]
        ])
      }
    );
  }
  
  const targetId = args[1];
  
  if (data.admins.includes(targetId)) {
    return ctx.reply(
      q(
        `⚠️ *User sudah menjadi admin!*\n\n` +
        `User dengan ID \`${targetId}\` sudah memiliki akses admin.`
      ),
      { parse_mode: 'HTML' }
    );
  }
  
  data.admins.push(targetId);
  
  let user = findUser(targetId);
  if (!user) {
    user = {
      userId: targetId,
      firstName: 'Unknown',
      username: 'Unknown',
      registeredAt: new Date().toISOString()
    };
  }
  user.isAdmin = true;
  user.addedBy = userId;
  user.addedAt = new Date().toISOString();
  saveUser(user);
  
  await saveData();
  
  await ctx.reply(
    q(
      `✅ *Berhasil Menambah Admin!*\n\n` +
      `User dengan ID \`${targetId}\` sekarang memiliki akses admin.\n\n` +
      `📌 *Fitur yang didapat:*\n` +
      `• Akses penuh ke bot\n` +
      `• Bisa menggunakan di grup lain\n` +
      `• Tidak perlu join channel\n` +
      `• Akses admin panel\n\n` +
      `💡 User sekarang bisa menggunakan bot di grup manapun.`
    ),
    { parse_mode: 'HTML' }
  );
  
  try {
    await bot.telegram.sendMessage(
      targetId,
      q(
        `🎉 *Selamat!*\n\n` +
        `Kamu sekarang menjadi *ADMIN* dari bot ini!\n\n` +
        `📌 *Akses yang didapat:*\n` +
        `• Bisa menggunakan bot di grup manapun\n` +
        `• Tidak perlu join channel\n` +
        `• Akses admin panel\n` +
        `• Full fitur bot`
      ),
      { parse_mode: 'HTML' }
    );
  } catch (error) {}
});

// ============================================
// COMMAND /cekid
// ============================================
bot.command('cekid', async (ctx) => {
  try {
    let targetId = ctx.from.id;
    
    if (ctx.message.reply_to_message) {
      targetId = ctx.message.reply_to_message.from.id;
    } else {
      const args = ctx.message.text.split(' ');
      if (args.length > 1) {
        targetId = parseInt(args[1]);
        if (isNaN(targetId)) {
          return ctx.reply(q(`❌ ID tidak valid!`), { parse_mode: 'HTML' });
        }
      }
    }
    
    const progressMsg = await ctx.reply(
      await showProgress(ctx, 'Mengambil data user...', 0, 3, '📊'),
      { parse_mode: 'HTML' }
    );
    
    for (let i = 1; i <= 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 400));
      await ctx.telegram.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        null,
        await showProgress(ctx, 'Mengambil data user...', i, 3, '📊'),
        { parse_mode: 'HTML' }
      );
    }
    
    await ctx.deleteMessage(progressMsg.message_id);
    
    const user = await bot.telegram.getChat(targetId);
    const userInfo = {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      username: user.username,
      bio: user.bio,
      dc_id: user.dc_id,
      join_date: user.join_date,
      isPremium: user.is_premium
    };
    
    const imageBuffer = await createIdCard(userInfo);
    
    await ctx.replyWithPhoto(
      { source: imageBuffer },
      {
        caption: q(
          `📊 *ID CARD USER*\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `👤 *Nama:* ${user.first_name} ${user.last_name || ''}\n` +
          `🆔 *ID:* ${user.id}\n` +
          `📛 *Username:* @${user.username || 'Tidak ada'}\n` +
          `📡 *DC:* ${user.dc_id || 'N/A'}\n` +
          `⭐ *Premium:* ${user.is_premium ? '✅ Ya' : '❌ Tidak'}\n\n` +
          `📅 *Join:* ${user.join_date ? moment(user.join_date).format('DD MMMM YYYY') : 'Tidak diketahui'}\n\n` +
          `💡 *Bio:* ${user.bio || 'Tidak ada bio'}`
        ),
        parse_mode: 'HTML'
      }
    );
  } catch (error) {
    console.error('Cek ID error:', error);
    await ctx.reply(
      q(
        `❌ *Gagal mengambil data user*\n\n` +
        `Pastikan ID yang dimasukkan benar dan bot memiliki akses.`
      ),
      { parse_mode: 'HTML' }
    );
  }
});

// ============================================
// PHOTO TO URL
// ============================================
bot.action('photo_to_url', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const text = q(
    `🖼️ *FOTO KE URL (CATBOX)*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Cara Penggunaan:*\n\n` +
    `1️⃣ Kirimkan foto (bisa dengan caption)\n` +
    `2️⃣ Bot akan upload ke Catbox\n` +
    `3️⃣ Dapatkan link URL permanen\n\n` +
    `💡 *Fitur:*\n` +
    `• Upload foto ke Catbox\n` +
    `• Dapatkan link permanen\n` +
    `• Bisa digunakan untuk berbagai keperluan\n\n` +
    `⏳ Tunggu sebentar saat upload...`
  );
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
  ctx.session.step = 'waiting_for_photo';
});

// Handler untuk foto
bot.on(message('photo'), async (ctx) => {
  if (ctx.session.step === 'waiting_for_photo') {
    try {
      const progressMsg = await ctx.reply(
        await showProgress(ctx, 'Upload ke Catbox...', 0, 3, '📤'),
        { parse_mode: 'HTML' }
      );
      
      for (let i = 1; i <= 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        await ctx.telegram.editMessageText(
          progressMsg.chat.id,
          progressMsg.message_id,
          null,
          await showProgress(ctx, 'Upload ke Catbox...', i, 3, '📤'),
          { parse_mode: 'HTML' }
        );
      }
      
      await ctx.deleteMessage(progressMsg.message_id);
      
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.telegram.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${config.BOT_TOKEN}/${file.file_path}`;
      const response = await axios({ url, responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      
      const result = await uploadToCatbox(buffer, 'photo.jpg');
      
      if (result.success) {
        await ctx.reply(
          q(
            `✅ *BERHASIL UPLOAD!*\n\n` +
            `🖼️ *URL Foto:*\n` +
            `\`${result.url}\`\n\n` +
            `📊 *Detail:*\n` +
            `• Size: ${(buffer.length / 1024).toFixed(2)} KB\n` +
            `• Format: JPG\n\n` +
            `💡 Klik tombol di bawah untuk copy URL:`
          ),
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.url('📋 COPY URL', result.url)],
              [Markup.button.callback('🔄 UPLOAD LAGI', 'photo_to_url')],
              [Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]
            ])
          }
        );
      } else {
        await ctx.reply(
          q(`❌ *Gagal upload ke Catbox*\n\nCoba lagi nanti.`),
          { parse_mode: 'HTML' }
        );
      }
    } catch (error) {
      console.error('Photo upload error:', error);
      await ctx.reply(
        q(`❌ *Terjadi kesalahan*\n\nCoba lagi nanti.`),
        { parse_mode: 'HTML' }
      );
    }
  }
});

// ============================================
// OTHER FEATURES MENU
// ============================================
bot.action('other_features', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const text = q(
    `🔧 *FITUR LAINNYA*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Fitur yang tersedia:*\n\n` +
    `• 🌐 Shortlink\n` +
    `• 📱 Cek ID (Canvas)\n` +
    `• 📊 Statistik\n` +
    `• ⏰ Reminder\n` +
    `• 📅 Kalender\n` +
    `• 🌍 Translate\n` +
    `• 📝 Catatan\n` +
    `• 📋 To-Do List\n` +
    `• 🎯 Random Number\n` +
    `• 🔐 Password Generator\n` +
    `• 📱 QR Code Generator\n` +
    `• 🗣️ Text to Speech\n` +
    `• 🌦️ Cuaca\n` +
    `• 📰 Berita\n` +
    `• 💵 Kurs Mata Uang\n` +
    `• 📈 Cryptocurrency\n` +
    `• Dan masih banyak lagi!\n\n` +
    `💡 Fitur-fitur ini akan segera hadir!`
  );
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// ANTI MENU
// ============================================
bot.action('anti_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const text = q(
    `🛡️ *ANTI LINK & TOXIC*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Status:*\n` +
    `• Anti Toxic: ${antiToxicEnabled ? '✅ AKTIF' : '❌ NONAKTIF'}\n` +
    `• Anti Link: ${antiLinkEnabled ? '✅ AKTIF' : '❌ NONAKTIF'}\n\n` +
    `📌 *Fungsi:*\n` +
    `• Anti Toxic: Memfilter kata-kata kasar\n` +
    `• Anti Link: Memblokir pesan berisi link\n\n` +
    `💡 Untuk mengaktifkan/mematikan, buka Admin Panel!`
  );
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ BUKA ADMIN PANEL', 'admin_panel')],
        [Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// GROUP MENU
// ============================================
bot.action('group_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const text = q(
    `👥 *MANAJEMEN GRUP*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Fitur Manajemen Grup:*\n\n` +
    `• 👋 Set Welcome Message\n` +
    `• 👋 Set Leave Message\n` +
    `• 📝 Add Filter Kata\n` +
    `• 📋 List Filter\n` +
    `• 🗑️ Remove Filter\n` +
    `• 👑 Promote User\n` +
    `• 📌 Demote User\n` +
    `• 🚫 Kick User\n` +
    `• 🔇 Mute/Unmute User\n` +
    `• 🔒 Anti Link\n` +
    `• 🛡️ Anti Toxic\n\n` +
    `💡 Bot harus menjadi admin di grup untuk fitur ini!`
  );
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// GAME MENU
// ============================================
bot.action('game_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const text = q(
    `🎮 *GAME CENTER (100+ GAME)*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Kategori Game:*\n\n` +
    `• 🎮 Puzzle Games\n` +
    `• 📚 Quiz Games\n` +
    `• 🎲 Luck Games\n` +
    `• ♠️ Card Games\n` +
    `• ✂️ Classic Games\n` +
    `• 📝 Word Games\n` +
    `• 🧠 Memory Games\n` +
    `• ♟️ Strategy Games\n` +
    `• 🎯 Shooter Games\n` +
    `• ⚔️ RPG Games\n` +
    `• 🏎️ Racing Games\n` +
    `• ⚽ Sports Games\n` +
    `• Dan masih banyak lagi!\n\n` +
    `💡 Fitur game akan segera hadir!`
  );
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// HD MEDIA MENU
// ============================================
let hdPage = 0;
const hdFeatures = [
  { id: 'hd_photo', name: '📸 HD Foto', desc: 'Upload foto kualitas HD ke Catbox' },
  { id: 'hd_video', name: '🎥 HD Video', desc: 'Upload video kualitas HD ke Catbox' },
  { id: 'photo_to_url', name: '🖼️ Foto ke URL', desc: 'Upload foto dapatkan link permanen' },
  { id: 'video_to_url', name: '🎬 Video ke URL', desc: 'Upload video dapatkan link permanen' },
  { id: 'convert_image', name: '🔄 Konversi Format', desc: 'Ubah format gambar (JPG/PNG/WEBP)' },
  { id: 'crop_image', name: '✂️ Crop Gambar', desc: 'Potong gambar sesuai keinginan' },
  { id: 'resize_image', name: '🔄 Resize Gambar', desc: 'Ubah ukuran gambar' },
  { id: 'edit_image', name: '🎨 Edit Foto', desc: 'Edit brightness, contrast, saturation' },
  { id: 'create_meme', name: '🖼️ Buat Meme', desc: 'Buat meme dari gambar' },
  { id: 'screenshot', name: '📸 Screenshot', desc: 'Screenshot website' }
];

bot.action('hd_media_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  hdPage = 0;
  await showHdMediaPage(ctx);
});

async function showHdMediaPage(ctx) {
  const start = hdPage * 5;
  const end = start + 5;
  const pageItems = hdFeatures.slice(start, end);
  const totalPages = Math.ceil(hdFeatures.length / 5);
  
  const text = q(
    `📸 *HD FOTO & VIDEO MENU*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Fitur HD Media:*\n\n` +
    pageItems.map((f, i) => `${start + i + 1}. ${f.name}\n   ${f.desc}`).join('\n\n') +
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📄 Halaman ${hdPage + 1} dari ${totalPages}`
  );
  
  const buttons = [];
  pageItems.forEach((f) => {
    buttons.push([Markup.button.callback(f.name, f.id)]);
  });
  
  const navButtons = [];
  if (hdPage > 0) {
    navButtons.push(Markup.button.callback('◀️ SEBELUMNYA', 'hd_prev'));
  }
  if (hdPage < totalPages - 1) {
    navButtons.push(Markup.button.callback('▶️ SELANJUTNYA', 'hd_next'));
  }
  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }
  buttons.push([Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]);
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }
  );
  await saveMessageId(ctx, sent.message_id);
}

bot.action('hd_next', async (ctx) => {
  await ctx.answerCbQuery();
  hdPage++;
  await deletePreviousMessages(ctx);
  await showHdMediaPage(ctx);
});

bot.action('hd_prev', async (ctx) => {
  await ctx.answerCbQuery();
  hdPage--;
  await deletePreviousMessages(ctx);
  await showHdMediaPage(ctx);
});

// ============================================
// MUSIC MENU
// ============================================
bot.action('music_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  ctx.session.step = 'waiting_for_music_query';
  
  const text = q(
    `🎵 *DOWNLOAD LAGU*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Cara Penggunaan:*\n\n` +
    `1️⃣ Kirimkan judul lagu atau penyanyi\n` +
    `2️⃣ Pilih lagu dari hasil pencarian\n` +
    `3️⃣ Pilih format MP3 atau MP4\n` +
    `4️⃣ Bot akan mengirimkan file lagu\n\n` +
    `💡 *Contoh:*\n` +
    `• "Taylor Swift" \n` +
    `• "Perfect Ed Sheeran"\n` +
    `• "Lagi Syantik"\n\n` +
    `⏹️ Ketik /cancel untuk membatalkan`
  );
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// Handler untuk mencari lagu
bot.on('text', async (ctx) => {
  if (ctx.session.step === 'waiting_for_music_query' && ctx.message.text !== '/cancel') {
    const query = ctx.message.text;
    
    const progressMsg = await ctx.reply(
      await showProgress(ctx, `Mencari "${query}"...`, 0, 3, '🔍'),
      { parse_mode: 'HTML' }
    );
    
    for (let i = 1; i <= 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await ctx.telegram.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        null,
        await showProgress(ctx, `Mencari "${query}"...`, i, 3, '🔍'),
        { parse_mode: 'HTML' }
      );
    }
    
    await ctx.deleteMessage(progressMsg.message_id);
    
    const results = await searchMusic(query);
    
    if (results.length === 0) {
      const sent = await ctx.reply(
        q(
          `❌ *Tidak ditemukan hasil*\n\n` +
          `Maaf, tidak ada lagu dengan judul "${query}".\n\n` +
          `💡 Coba dengan kata kunci yang berbeda.`
        ),
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 COBA LAGI', 'music_menu')],
            [Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]
          ])
        }
      );
      await saveMessageId(ctx, sent.message_id);
      return;
    }
    
    ctx.session.searchResults = results;
    ctx.session.currentPage = 0;
    ctx.session.step = 'waiting_for_music_selection';
    await showMusicResults(ctx);
  }
  
  if (ctx.message.text === '/cancel') {
    ctx.session.step = null;
    await ctx.reply(
      q(`✅ *Pencarian dibatalkan*`),
      { parse_mode: 'HTML' }
    );
  }
});

async function showMusicResults(ctx) {
  const results = ctx.session.searchResults;
  const page = ctx.session.currentPage || 0;
  const itemsPerPage = 3;
  const start = page * itemsPerPage;
  const end = start + itemsPerPage;
  const pageItems = results.slice(start, end);
  const totalPages = Math.ceil(results.length / itemsPerPage);
  
  const text = q(
    `🎵 *Hasil Pencarian Lagu*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *${results.length} hasil ditemukan*\n\n` +
    pageItems.map((item, i) => 
      `${start + i + 1}. *${item.title}*\n` +
      `   🕐 ${item.duration} | 👁️ ${item.views} | 📺 ${item.channel}`
    ).join('\n\n') +
    `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📄 Halaman ${page + 1} dari ${totalPages}\n\n` +
    `💡 Klik tombol di bawah untuk memilih lagu`
  );
  
  const buttons = [];
  pageItems.forEach((item, index) => {
    buttons.push([
      Markup.button.callback(
        `${start + index + 1}. ${item.title.substring(0, 30)}${item.title.length > 30 ? '...' : ''}`,
        `select_music_${start + index}`
      )
    ]);
  });
  
  const navButtons = [];
  if (page > 0) {
    navButtons.push(Markup.button.callback('◀️ SEBELUMNYA', 'music_prev'));
  }
  if (page < totalPages - 1) {
    navButtons.push(Markup.button.callback('▶️ SELANJUTNYA', 'music_next'));
  }
  if (navButtons.length > 0) {
    buttons.push(navButtons);
  }
  buttons.push([Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]);
  
  await deletePreviousMessages(ctx);
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }
  );
  await saveMessageId(ctx, sent.message_id);
}

bot.action('music_next', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.currentPage = (ctx.session.currentPage || 0) + 1;
  await deletePreviousMessages(ctx);
  await showMusicResults(ctx);
});

bot.action('music_prev', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.currentPage = (ctx.session.currentPage || 0) - 1;
  await deletePreviousMessages(ctx);
  await showMusicResults(ctx);
});

// Handler untuk memilih lagu
bot.action(/select_music_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const index = parseInt(ctx.match[1]);
  const results = ctx.session.searchResults;
  
  if (!results || index >= results.length) {
    return ctx.reply(
      q(`❌ *Lagu tidak ditemukan*`),
      { parse_mode: 'HTML' }
    );
  }
  
  const selected = results[index];
  ctx.session.selectedSong = selected;
  
  const text = q(
    `🎵 *Lagu Dipilih:*\n\n` +
    `📌 *${selected.title}*\n` +
    `🕐 Duration: ${selected.duration}\n` +
    `👁️ Views: ${selected.views}\n` +
    `📺 Channel: ${selected.channel}\n\n` +
    `📌 *Pilih format download:*\n` +
    `• MP3 - Audio only\n` +
    `• MP4 - Video + Audio`
  );
  
  await deletePreviousMessages(ctx);
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🎵 DOWNLOAD MP3', `download_mp3_${index}`)],
        [Markup.button.callback('🎬 DOWNLOAD MP4', `download_mp4_${index}`)],
        [Markup.button.callback('🔙 KEMBALI KE HASIL', 'music_menu_back')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

bot.action('music_menu_back', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  await showMusicResults(ctx);
});

// Handler untuk download MP3
bot.action(/download_mp3_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery('⏳ Mengunduh MP3...', { show_alert: true });
  const index = parseInt(ctx.match[1]);
  const results = ctx.session.searchResults;
  
  if (!results || index >= results.length) {
    return ctx.reply(
      q(`❌ *Gagal download*`),
      { parse_mode: 'HTML' }
    );
  }
  
  const selected = results[index];
  
  try {
    const progressMsg = await ctx.reply(
      await showProgress(ctx, `Mengunduh MP3...`, 0, 5, '📥'),
      { parse_mode: 'HTML' }
    );
    
    for (let i = 1; i <= 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await ctx.telegram.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        null,
        await showProgress(ctx, `Mengunduh MP3...`, i, 5, '📥'),
        { parse_mode: 'HTML' }
      );
    }
    
    await ctx.deleteMessage(progressMsg.message_id);
    
    const result = await downloadYouTube(selected.url, 'mp3');
    
    await ctx.replyWithAudio(
      { source: result.path },
      {
        caption: q(
          `🎵 *MP3 Selesai!*\n\n` +
          `📌 ${selected.title}\n` +
          `🕐 Duration: ${selected.duration}\n` +
          `📺 Channel: ${selected.channel}\n\n` +
          `✅ Download berhasil!`
        ),
        parse_mode: 'HTML',
        title: selected.title,
        performer: selected.channel
      }
    );
    
    await fs.remove(result.path);
    ctx.session.step = null;
    
  } catch (error) {
    console.error('Download error:', error);
    await ctx.reply(
      q(
        `❌ *Gagal download MP3*\n\n` +
        `Terjadi kesalahan saat mendownload lagu.\n\n` +
        `💡 Coba lagi nanti.`
      ),
      { parse_mode: 'HTML' }
    );
  }
});

// Handler untuk download MP4
bot.action(/download_mp4_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery('⏳ Mengunduh MP4...', { show_alert: true });
  const index = parseInt(ctx.match[1]);
  const results = ctx.session.searchResults;
  
  if (!results || index >= results.length) {
    return ctx.reply(
      q(`❌ *Gagal download*`),
      { parse_mode: 'HTML' }
    );
  }
  
  const selected = results[index];
  
  try {
    const progressMsg = await ctx.reply(
      await showProgress(ctx, `Mengunduh MP4...`, 0, 5, '📥'),
      { parse_mode: 'HTML' }
    );
    
    for (let i = 1; i <= 5; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await ctx.telegram.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        null,
        await showProgress(ctx, `Mengunduh MP4...`, i, 5, '📥'),
        { parse_mode: 'HTML' }
      );
    }
    
    await ctx.deleteMessage(progressMsg.message_id);
    
    const result = await downloadYouTube(selected.url, 'mp4');
    
    await ctx.replyWithVideo(
      { source: result.path },
      {
        caption: q(
          `🎬 *MP4 Selesai!*\n\n` +
          `📌 ${selected.title}\n` +
          `🕐 Duration: ${selected.duration}\n` +
          `📺 Channel: ${selected.channel}\n\n` +
          `✅ Download berhasil!`
        ),
        parse_mode: 'HTML'
      }
    );
    
    await fs.remove(result.path);
    ctx.session.step = null;
    
  } catch (error) {
    console.error('Download error:', error);
    await ctx.reply(
      q(
        `❌ *Gagal download MP4*\n\n` +
        `Terjadi kesalahan saat mendownload video.\n\n` +
        `💡 Coba lagi nanti.`
      ),
      { parse_mode: 'HTML' }
    );
  }
});

// ============================================
// OWNER MENU
// ============================================
bot.action('owner_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const isOwner = ctx.from.id.toString() === config.OWNER_ID;
  
  const ownerText = q(
    `👑 *OWNER MENU*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Informasi Owner:*\n` +
    `• ID: ${config.OWNER_ID}\n` +
    `• Username: ${config.OWNER_USERNAME}\n\n` +
    `💡 *Kontak Owner:*\n` +
    `• Klik tombol di bawah untuk chat\n\n` +
    `🔹 *Fitur Owner:*\n` +
    `• Menambah admin dengan /add [ID]\n` +
    `• Mengelola bot\n` +
    `• Akses penuh ke semua fitur\n\n` +
    `📌 *Cara Menambah Admin:*\n` +
    `1. Dapatkan ID user (gunakan /cekid)\n` +
    `2. Kirim /add [ID]\n` +
    `3. User akan mendapatkan akses admin`
  );
  
  const buttons = [];
  
  if (isOwner) {
    buttons.push([Markup.button.callback('➕ TAMBAH ADMIN', 'add_admin')]);
    buttons.push([Markup.button.callback('📊 LIST ADMIN', 'list_admin')]);
  }
  
  buttons.push([Markup.button.url('💬 CHAT OWNER', `https://t.me/${config.OWNER_USERNAME.replace('@', '')}`)]);
  buttons.push([Markup.button.callback('🔙 KEMBALI KE MENU', 'main_menu')]);
  
  const sent = await ctx.reply(
    ownerText,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// LIST ADMIN
// ============================================
bot.action('list_admin', async (ctx) => {
  await ctx.answerCbQuery();
  const isOwner = ctx.from.id.toString() === config.OWNER_ID;
  if (!isOwner) {
    return ctx.reply(q(`❌ Hanya owner!`), { parse_mode: 'HTML' });
  }
  
  if (data.admins.length === 0) {
    return ctx.reply(q(`📊 *Belum ada admin*`), { parse_mode: 'HTML' });
  }
  
  let list = q(
    `👑 *LIST ADMIN*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`
  );
  
  data.admins.forEach((adminId, index) => {
    const user = findUser(adminId);
    list += `${index + 1}. ID: \`${adminId}\`\n`;
    if (user) {
      if (user.username) list += `   Username: @${user.username}\n`;
      if (user.firstName) list += `   Nama: ${user.firstName}\n`;
    }
    list += `\n`;
  });
  
  const sent = await ctx.reply(
    list,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE OWNER MENU', 'owner_menu')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// ADD ADMIN VIA BUTTON
// ============================================
bot.action('add_admin', async (ctx) => {
  await ctx.answerCbQuery();
  const isOwner = ctx.from.id.toString() === config.OWNER_ID;
  if (!isOwner) {
    return ctx.reply(q(`❌ Hanya owner yang bisa menambah admin!`), { parse_mode: 'HTML' });
  }
  
  ctx.session.step = 'waiting_for_admin_id';
  
  await deletePreviousMessages(ctx);
  const sent = await ctx.reply(
    q(
      `📌 *Tambah Admin*\n\n` +
      `Kirimkan ID user yang ingin dijadikan admin.\n\n` +
      `💡 *Cara dapat ID:*\n` +
      `• Kirim /cekid\n` +
      `• Atau forward pesan ke @userinfobot\n\n` +
      `Contoh: \`123456789\`\n\n` +
      `⏹️ Ketik /cancel untuk membatalkan.`
    ),
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('❌ BATAL', 'cancel_add_admin')],
        [Markup.button.callback('🔙 KEMBALI', 'owner_menu')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

bot.action('cancel_add_admin', async (ctx) => {
  ctx.session.step = null;
  await ctx.answerCbQuery('✅ Pembatalan berhasil!');
  await deletePreviousMessages(ctx);
  await ctx.action('owner_menu');
});

// Handler untuk ID admin
bot.on('text', async (ctx) => {
  if (ctx.session.step === 'waiting_for_admin_id') {
    const userId = ctx.from.id.toString();
    
    if (userId !== config.OWNER_ID) {
      ctx.session.step = null;
      return ctx.reply(q(`❌ Hanya owner yang bisa menambah admin!`), { parse_mode: 'HTML' });
    }
    
    const targetId = ctx.message.text.trim();
    
    if (!/^\d+$/.test(targetId)) {
      return ctx.reply(
        q(
          `❌ *ID tidak valid!*\n\n` +
          `ID harus berupa angka.\n\n` +
          `Contoh: \`123456789\``
        ),
        { parse_mode: 'HTML' }
      );
    }
    
    if (data.admins.includes(targetId)) {
      ctx.session.step = null;
      return ctx.reply(
        q(
          `⚠️ *User sudah menjadi admin!*\n\n` +
          `User dengan ID \`${targetId}\` sudah memiliki akses admin.`
        ),
        { parse_mode: 'HTML' }
      );
    }
    
    data.admins.push(targetId);
    
    let user = findUser(targetId);
    if (!user) {
      user = {
        userId: targetId,
        firstName: 'Unknown',
        username: 'Unknown',
        registeredAt: new Date().toISOString()
      };
    }
    user.isAdmin = true;
    user.addedBy = userId;
    user.addedAt = new Date().toISOString();
    saveUser(user);
    
    await saveData();
    ctx.session.step = null;
    
    await ctx.reply(
      q(
        `✅ *Berhasil Menambah Admin!*\n\n` +
        `User dengan ID \`${targetId}\` sekarang memiliki akses admin.\n\n` +
        `📌 *Fitur yang didapat:*\n` +
        `• Akses penuh ke bot\n` +
        `• Bisa menggunakan di grup lain\n` +
        `• Tidak perlu join channel\n` +
        `• Akses admin panel\n\n` +
        `💡 User sekarang bisa menggunakan bot di grup manapun.`
      ),
      { parse_mode: 'HTML' }
    );
    
    try {
      await bot.telegram.sendMessage(
        targetId,
        q(
          `🎉 *Selamat!*\n\n` +
          `Kamu sekarang menjadi *ADMIN* dari bot ini!\n\n` +
          `📌 *Akses yang didapat:*\n` +
          `• Bisa menggunakan bot di grup manapun\n` +
          `• Tidak perlu join channel\n` +
          `• Akses admin panel\n` +
          `• Full fitur bot`
        ),
        { parse_mode: 'HTML' }
      );
    } catch (error) {}
  }
});

// ============================================
// CEK ID MENU
// ============================================
bot.action('cek_id_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  
  const text = q(
    `📊 *CEK ID USER (CANVAS)*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `📌 *Fitur ini akan menampilkan:*\n\n` +
    `• Foto profil user\n` +
    `• ID Telegram\n` +
    `• Username\n` +
    `• Data Center (DC)\n` +
    `• Bio / Deskripsi\n` +
    `• Tanggal bergabung\n\n` +
    `💡 *Cara penggunaan:*\n` +
    `Kirimkan /cekid [ID] atau reply pesan user dengan /cekid`
  );
  
  const sent = await ctx.reply(
    text,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔙 KEMBALI KE TOOLS', 'tools_menu')]
      ])
    }
  );
  await saveMessageId(ctx, sent.message_id);
});

// ============================================
// MAIN MENU HANDLER
// ============================================
bot.action('main_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePreviousMessages(ctx);
  await showMainMenu(ctx);
});

// ============================================
// RUN BOT
// ============================================
bot.launch().then(() => {
  console.log(`✅ Bot ${config.BOT_NAME} started!`);
  console.log(`👑 Owner: ${config.OWNER_ID}`);
  console.log(`📢 Channel: ${config.CHANNEL_ID}`);
  console.log(`🔧 Maintenance: ${isMaintenance ? 'ON' : 'OFF'}`);
  console.log(`🛡️ Anti Toxic: ${antiToxicEnabled ? 'ON' : 'OFF'}`);
  console.log(`🔗 Anti Link: ${antiLinkEnabled ? 'ON' : 'OFF'}`);
  console.log(`💾 GitHub Repo: ${github.getRepoUrl()}`);
}).catch(err => {
  console.error('❌ Bot failed to start:', err);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));