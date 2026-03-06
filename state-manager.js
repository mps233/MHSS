const fs = require('fs');
const path = require('path');

// 状态文件路径
const STATE_FILE = path.join(__dirname, 'data', 'app_state.json');
const DATA_DIR = path.join(__dirname, 'data');

// 确保 data 目录存在
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('✓ 已创建 data 目录');
  } catch (error) {
    console.error('❌ 创建 data 目录失败:', error.message);
  }
}

// 旧文件路径（用于迁移）
const OLD_FILES = {
  sessions: path.join(__dirname, 'sessions.json'),
  userData: path.join(__dirname, 'user_data.json'),
  scheduler: path.join(__dirname, 'scheduler_state.json'),
  autoSearchNew: path.join(__dirname, 'auto_search_new.json'),
  hdhive: path.join(__dirname, 'hdhive_state.json')
};

// 默认状态
const DEFAULT_STATE = {
  sessions: {},
  userData: {
    limits: {},
    counts: {}
  },
  scheduler: {
    enabled: false,
    nextRun: null,
    intervalHours: 72
  },
  autoSearchNew: {
    enabled: false,
    autoDeleteCompletedMovie: false,
    autoDeleteCompletedTV: false
  },
  hdhive: {
    cookie: null,
    lastRefresh: null
  }
};

// 内存中的状态
let state = null;
let saveTimeout = null;

// 从旧文件迁移数据
function migrateFromOldFiles() {
  console.log('🔄 检测到旧的状态文件，开始迁移...');
  const migratedState = { ...DEFAULT_STATE };
  let hasMigrated = false;

  // 迁移 sessions
  if (fs.existsSync(OLD_FILES.sessions)) {
    try {
      const data = JSON.parse(fs.readFileSync(OLD_FILES.sessions, 'utf8'));
      migratedState.sessions = data;
      hasMigrated = true;
      console.log('  ✓ 迁移 sessions.json');
    } catch (error) {
      console.error('  ✗ 迁移 sessions.json 失败:', error.message);
    }
  }

  // 迁移 userData
  if (fs.existsSync(OLD_FILES.userData)) {
    try {
      const data = JSON.parse(fs.readFileSync(OLD_FILES.userData, 'utf8'));
      migratedState.userData = data;
      hasMigrated = true;
      console.log('  ✓ 迁移 user_data.json');
    } catch (error) {
      console.error('  ✗ 迁移 user_data.json 失败:', error.message);
    }
  }

  // 迁移 scheduler
  if (fs.existsSync(OLD_FILES.scheduler)) {
    try {
      const data = JSON.parse(fs.readFileSync(OLD_FILES.scheduler, 'utf8'));
      migratedState.scheduler = { ...DEFAULT_STATE.scheduler, ...data };
      hasMigrated = true;
      console.log('  ✓ 迁移 scheduler_state.json');
    } catch (error) {
      console.error('  ✗ 迁移 scheduler_state.json 失败:', error.message);
    }
  }

  // 迁移 autoSearchNew
  if (fs.existsSync(OLD_FILES.autoSearchNew)) {
    try {
      const data = JSON.parse(fs.readFileSync(OLD_FILES.autoSearchNew, 'utf8'));
      migratedState.autoSearchNew = { ...DEFAULT_STATE.autoSearchNew, ...data };
      hasMigrated = true;
      console.log('  ✓ 迁移 auto_search_new.json');
    } catch (error) {
      console.error('  ✗ 迁移 auto_search_new.json 失败:', error.message);
    }
  }

  // 迁移 hdhive
  if (fs.existsSync(OLD_FILES.hdhive)) {
    try {
      const data = JSON.parse(fs.readFileSync(OLD_FILES.hdhive, 'utf8'));
      migratedState.hdhive = data;
      hasMigrated = true;
      console.log('  ✓ 迁移 hdhive_state.json');
    } catch (error) {
      console.error('  ✗ 迁移 hdhive_state.json 失败:', error.message);
    }
  }

  if (hasMigrated) {
    console.log('✅ 迁移完成，保存到 data/app_state.json');
    return migratedState;
  }

  return null;
}

// 加载状态
function loadState() {
  if (state !== null) {
    return state;
  }

  // 确保 data 目录存在
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // 尝试加载新的状态文件
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      state = JSON.parse(data);
      console.log('📂 已加载状态文件: data/app_state.json');
      return state;
    } catch (error) {
      console.error('❌ 加载状态文件失败:', error.message);
    }
  }

  // 尝试从旧文件迁移
  const migratedState = migrateFromOldFiles();
  if (migratedState) {
    state = migratedState;
    saveStateSync(); // 立即保存迁移后的状态
    return state;
  }

  // 使用默认状态
  console.log('📂 使用默认状态');
  state = JSON.parse(JSON.stringify(DEFAULT_STATE));
  saveStateSync();
  return state;
}

// 同步保存状态
function saveStateSync() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('❌ 保存状态文件失败:', error.message);
  }
}

// 异步保存状态（防抖）
function saveState() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    saveStateSync();
    saveTimeout = null;
  }, 1000); // 1秒防抖
}

// 获取状态的某个部分
function getState(key) {
  const currentState = loadState();
  return key ? currentState[key] : currentState;
}

// 更新状态的某个部分
function setState(key, value) {
  const currentState = loadState();
  currentState[key] = value;
  saveState();
}

// 更新状态的某个部分（同步）
function setStateSync(key, value) {
  const currentState = loadState();
  currentState[key] = value;
  saveStateSync();
}

module.exports = {
  loadState,
  saveState,
  saveStateSync,
  getState,
  setState,
  setStateSync
};
