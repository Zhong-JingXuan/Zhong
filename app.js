// ==== 全局变量 ====
let isAdmin = false;
let tasks = JSON.parse(localStorage.getItem('tasks_v2')) || [];
let editingTaskId = null;
let fileSha = null; // GitHub 文件 SHA
let githubConfig = null; // GitHub 配置

// ==== 初始化 ====
window.onload = async function() {
  // 初始化登录状态
  const savedAdmin = localStorage.getItem('isAdmin') === 'true';
  if (savedAdmin) {
    isAdmin = true;
  }
  
  // 先渲染界面，确保页面可见
  updateAuthUI();
  renderTable();
  
  // 然后尝试获取 GitHub 配置（失败不影响页面显示）
  try {
    const configRes = await fetch('/api/config');
    if (configRes.ok) {
      githubConfig = await configRes.json();
      // 从 GitHub 加载数据
      if (githubConfig.githubOwner && githubConfig.githubRepo) {
        await loadFromGitHub();
      }
    }
  } catch (error) {
    console.error('获取配置失败（使用本地数据）:', error);
    // 静默失败，使用本地数据
  }
};

// ==== 登录相关 ====
async function handleAuth() {
  if (!isAdmin) {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !password) {
      alert('请填写账号和密码');
      return;
    }

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const result = await response.json();

      if (result.success) {
        isAdmin = true;
        localStorage.setItem('isAdmin', 'true');
        alert('登录成功，欢迎管理员！');
      } else {
        alert(result.message || '账号或密码错误');
        return;
      }
    } catch (error) {
      console.error('登录失败:', error);
      alert('登录失败，请稍后重试');
      return;
    }
  } else {
    // 登出
    isAdmin = false;
    localStorage.setItem('isAdmin', 'false');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    cancelForm();
  }
  updateAuthUI();
  renderTable();
}

function updateAuthUI() {
  const authStatus = document.getElementById('authStatus');
  const loginBtn = document.getElementById('loginBtn');
  const addTaskBtn = document.getElementById('addTaskBtn');
  const addHint = document.getElementById('addHint');

  if (isAdmin) {
    authStatus.textContent = '当前状态：已登录（管理员）';
    loginBtn.textContent = '退出登录';
    addTaskBtn.disabled = false;
    addHint.textContent = '已登录管理员，可以添加、修改和删除事项。';
  } else {
    authStatus.textContent = '当前状态：未登录';
    loginBtn.textContent = '登录';
    addTaskBtn.disabled = true;
    addHint.textContent = '只有管理员登录后才可以添加、修改和删除事项。当前为只读查看模式。';
  }
}

function ensureAdmin() {
  if (!isAdmin) {
    alert('只有管理员登录后才可以进行此操作。');
    return false;
  }
  return true;
}

// ==== GitHub 数据操作 ====
async function loadFromGitHub() {
  if (!githubConfig || !githubConfig.githubOwner || !githubConfig.githubRepo) {
    renderTable();
    return;
  }

  showSyncStatus('正在从 GitHub 加载数据...', 'loading');

  try {
    const response = await fetch('/api/github?action=read');
    
    if (response.status === 404) {
      // GitHub 上暂无数据，如果有本地数据，尝试同步到 GitHub
      const localTasks = JSON.parse(localStorage.getItem('tasks_v2')) || [];
      if (localTasks.length > 0) {
        tasks = localTasks;
        showSyncStatus('GitHub 上暂无数据，使用本地数据，正在同步到 GitHub...', 'loading');
        try {
          await saveToGitHub();
          showSyncStatus('✓ 本地数据已同步到 GitHub', 'success');
          setTimeout(() => hideSyncStatus(), 3000);
        } catch (error) {
          showSyncStatus('使用本地数据，但同步到 GitHub 失败', 'error');
          setTimeout(() => hideSyncStatus(), 5000);
        }
      } else {
        showSyncStatus('GitHub 上暂无数据，使用本地数据', 'success');
        setTimeout(() => hideSyncStatus(), 3000);
      }
      renderTable();
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    fileSha = result.sha;
    const githubTasks = result.data || [];
    
    // 如果 GitHub 返回空数组但本地有数据，保留本地数据并尝试同步
    if (githubTasks.length === 0) {
      const localTasks = JSON.parse(localStorage.getItem('tasks_v2')) || [];
      if (localTasks.length > 0) {
        tasks = localTasks;
        showSyncStatus('GitHub 数据为空，使用本地数据，正在同步到 GitHub...', 'loading');
        try {
          await saveToGitHub();
          showSyncStatus('✓ 本地数据已同步到 GitHub', 'success');
          setTimeout(() => hideSyncStatus(), 3000);
        } catch (error) {
          showSyncStatus('使用本地数据，但同步到 GitHub 失败', 'error');
          setTimeout(() => hideSyncStatus(), 5000);
        }
        renderTable();
        return;
      }
    }
    
    tasks = githubTasks;
    localStorage.setItem('tasks_v2', JSON.stringify(tasks));
    
    showSyncStatus('✓ 数据已从 GitHub 同步', 'success');
    setTimeout(() => hideSyncStatus(), 3000);
    renderTable();
  } catch (error) {
    console.error('加载 GitHub 数据失败:', error);
    showSyncStatus('✗ 从 GitHub 加载失败，使用本地数据', 'error');
    setTimeout(() => hideSyncStatus(), 5000);
    renderTable();
  }
}

async function saveToGitHub() {
  if (!githubConfig || !githubConfig.githubOwner || !githubConfig.githubRepo) {
    return;
  }

  showSyncStatus('正在同步到 GitHub...', 'loading');

  try {
    const response = await fetch('/api/github?action=write', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        data: tasks,
        sha: fileSha
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    fileSha = result.sha;

    showSyncStatus('✓ 数据已同步到 GitHub', 'success');
    setTimeout(() => hideSyncStatus(), 3000);
  } catch (error) {
    console.error('保存到 GitHub 失败:', error);
    showSyncStatus('✗ 同步到 GitHub 失败: ' + error.message, 'error');
    setTimeout(() => hideSyncStatus(), 5000);
    throw error;
  }
}

function showSyncStatus(message, type) {
  let statusEl = document.getElementById('syncStatus');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'syncStatus';
    statusEl.className = 'sync-status';
    const content = document.querySelector('.content');
    content.insertBefore(statusEl, content.firstChild);
  }
  statusEl.textContent = message;
  statusEl.className = `sync-status ${type}`;
}

function hideSyncStatus() {
  const statusEl = document.getElementById('syncStatus');
  if (statusEl) {
    statusEl.style.display = 'none';
  }
}

// ==== 表单与时间类型切换 ====
function toggleForm() {
  if (!ensureAdmin()) return;

  const form = document.getElementById('taskForm');
  form.classList.toggle('active');

  if (form.classList.contains('active')) {
    resetForm();
  }
}

function cancelForm() {
  document.getElementById('taskForm').classList.remove('active');
  editingTaskId = null;
  document.getElementById('submitBtn').textContent = '确认';
}

function resetForm() {
  document.getElementById('event').value = '';
  document.getElementById('target').value = 'ALL';
  document.getElementById('detail').value = '';
  document.getElementById('activityDate').value = '';
  document.getElementById('activityStartTime').value = '';
  document.getElementById('activityEndTime').value = '';
  document.getElementById('deadlineDate').value = '';
  document.getElementById('deadlineTime').value = '';
  editingTaskId = null;
  document.getElementById('submitBtn').textContent = '确认';

  // 默认选中活动时间
  document.querySelector('input[name="timeType"][value="activity"]').checked = true;
  switchTimeType();
}

function switchTimeType() {
  const selected = document.querySelector('input[name="timeType"]:checked').value;
  const activityRow = document.getElementById('activityTimeRow');
  const deadlineRow = document.getElementById('deadlineRow');

  if (selected === 'activity') {
    activityRow.style.display = '';
    deadlineRow.style.display = 'none';
  } else {
    activityRow.style.display = 'none';
    deadlineRow.style.display = '';
  }
}

// ==== 添加 / 编辑任务 ====
async function submitTask() {
  if (!ensureAdmin()) return;

  const event = document.getElementById('event').value.trim();
  const target = document.getElementById('target').value;
  const detail = document.getElementById('detail').value.trim();
  const timeType = document.querySelector('input[name="timeType"]:checked').value;

  if (!event || !target) {
    alert('请填写事项和面向对象');
    return;
  }

  let taskData = {
    event,
    target,
    detail,
    timeType
  };

  if (timeType === 'activity') {
    const activityDate = document.getElementById('activityDate').value;
    const activityStartTime = document.getElementById('activityStartTime').value;
    const activityEndTime = document.getElementById('activityEndTime').value;

    if (!activityDate) {
      alert('请选择活动日期');
      return;
    }

    if (activityStartTime && activityEndTime) {
      const startDateTime = new Date(activityDate + 'T' + activityStartTime);
      const endDateTime = new Date(activityDate + 'T' + activityEndTime);

      if (endDateTime <= startDateTime) {
        alert('结束时间必须晚于开始时间');
        return;
      }
    }

    taskData.activityDate = activityDate;
    taskData.activityStartTime = activityStartTime || '';
    taskData.activityEndTime = activityEndTime || '';
  } else {
    const deadlineDate = document.getElementById('deadlineDate').value;
    const deadlineTime = document.getElementById('deadlineTime').value;

    if (!deadlineDate) {
      alert('请选择截止日期');
      return;
    }

    taskData.deadlineDate = deadlineDate;
    taskData.deadlineTime = deadlineTime || '';
  }

  if (editingTaskId) {
    // 更新已有任务
    tasks = tasks.map(task => {
      if (task.id === editingTaskId) {
        return {
          ...task,
          ...taskData
        };
      }
      return task;
    });
  } else {
    // 新增任务，保持输入顺序，用createdAt保存顺序
    const newTask = {
      id: Date.now(),
      createdAt: Date.now(),
      ...taskData
    };
    tasks.push(newTask);
  }

  // 先保存到本地
  localStorage.setItem('tasks_v2', JSON.stringify(tasks));
  renderTable();
  cancelForm();

  // 然后同步到 GitHub
  if (githubConfig && githubConfig.githubOwner && githubConfig.githubRepo) {
    try {
      await saveToGitHub();
    } catch (error) {
      console.error('同步到 GitHub 失败:', error);
      // 不同步失败不影响本地保存
    }
  }
}

function editTask(id) {
  if (!ensureAdmin()) return;

  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const form = document.getElementById('taskForm');
  if (!form.classList.contains('active')) {
    form.classList.add('active');
  }

  document.getElementById('event').value = task.event;
  document.getElementById('target').value = task.target;
  document.getElementById('detail').value = task.detail || '';

  if (task.timeType === 'activity') {
    document.querySelector('input[name="timeType"][value="activity"]').checked = true;
    switchTimeType();
    document.getElementById('activityDate').value = task.activityDate || '';
    document.getElementById('activityStartTime').value = task.activityStartTime || '';
    document.getElementById('activityEndTime').value = task.activityEndTime || '';
    document.getElementById('deadlineDate').value = '';
    document.getElementById('deadlineTime').value = '';
  } else {
    document.querySelector('input[name="timeType"][value="deadline"]').checked = true;
    switchTimeType();
    document.getElementById('deadlineDate').value = task.deadlineDate || '';
    document.getElementById('deadlineTime').value = task.deadlineTime || '';
    document.getElementById('activityDate').value = '';
    document.getElementById('activityStartTime').value = '';
    document.getElementById('activityEndTime').value = '';
  }

  editingTaskId = id;
  document.getElementById('submitBtn').textContent = '保存修改';
}

async function deleteTask(id) {
  if (!ensureAdmin()) return;

  if (confirm('确定要删除这个任务吗？')) {
    tasks = tasks.filter(task => task.id !== id);
    // 先保存到本地
    localStorage.setItem('tasks_v2', JSON.stringify(tasks));
    renderTable();

    // 然后同步到 GitHub
    if (githubConfig && githubConfig.githubOwner && githubConfig.githubRepo) {
      try {
        await saveToGitHub();
      } catch (error) {
        console.error('同步到 GitHub 失败:', error);
      }
    }
  }
}

// ==== 保存与渲染 ====
function getStartDate(task) {
  if (task.timeType === 'activity') {
    const date = task.activityDate || '';
    if (!date) return null;
    const time = task.activityStartTime || '00:00';
    return new Date(date + 'T' + time);
  } else {
    const date = task.deadlineDate || '';
    if (!date) return null;
    const time = task.deadlineTime || '00:00';
    return new Date(date + 'T' + time);
  }
}

function getEndDate(task) {
  if (task.timeType === 'activity') {
    const date = task.activityDate || '';
    if (!date) return null;
    const time = task.activityEndTime || task.activityStartTime || '23:59';
    return new Date(date + 'T' + time);
  } else {
    const date = task.deadlineDate || '';
    if (!date) return null;
    const time = task.deadlineTime || '23:59';
    return new Date(date + 'T' + time);
  }
}

function getStatus(task) {
  const now = new Date();

  const start = getStartDate(task);
  const end = getEndDate(task);

  if (!start && !end) {
    return '未开始';
  }

  if (start && now < start) {
    return '未开始';
  }

  if (start && end && now >= start && now <= end) {
    return '进行中';
  }

  if (!start && end && now <= end) {
    return '进行中';
  }

  return '已截止';
}

function formatDateCN(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parts[0];
  const month = String(parseInt(parts[1], 10));
  const day = String(parseInt(parts[2], 10));
  return `${year}年${month}月${day}日`;
}

function formatTimeDetail(task) {
  if (task.timeType === 'activity') {
    const datePart = formatDateCN(task.activityDate);
    const start = task.activityStartTime || '';
    const end = task.activityEndTime || '';
    if (start && end) {
      return `${datePart} ${start} - ${end}`;
    }
    if (start && !end) {
      return `${datePart} ${start}`;
    }
    if (!start && end) {
      return `${datePart} 结束 ${end}`;
    }
    return datePart;
  } else {
    const datePart = formatDateCN(task.deadlineDate);
    const time = task.deadlineTime || '';
    if (time) {
      return `${datePart} ${time}`;
    }
    return datePart;
  }
}

function renderTable() {
  const emptyState = document.getElementById('emptyState');
  const tbodyInProgress = document.getElementById('tbodyInProgress');
  const tbodyNotStarted = document.getElementById('tbodyNotStarted');
  const tbodyEnded = document.getElementById('tbodyEnded');
  const countInProgress = document.getElementById('countInProgress');
  const countNotStarted = document.getElementById('countNotStarted');
  const countEnded = document.getElementById('countEnded');

  if (!tasks || tasks.length === 0) {
    tbodyInProgress.innerHTML = '';
    tbodyNotStarted.innerHTML = '';
    tbodyEnded.innerHTML = '';
    countInProgress.textContent = '';
    countNotStarted.textContent = '';
    countEnded.textContent = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  // 序号按照创建顺序
  const orderMap = {};
  tasks
    .slice()
    .sort((a, b) => (a.createdAt || a.id) - (b.createdAt || b.id))
    .forEach((task, index) => {
      orderMap[task.id] = index + 1;
    });

  const inProgressTasks = [];
  const notStartedTasks = [];
  const endedTasks = [];

  tasks.forEach(task => {
    const status = getStatus(task);
    if (status === '进行中') {
      inProgressTasks.push(task);
    } else if (status === '未开始') {
      notStartedTasks.push(task);
    } else {
      endedTasks.push(task);
    }
  });

  // 排序：进行中按截止/活动时间，未开始按开始时间/日期，已截止按序号
  inProgressTasks.sort((a, b) => {
    const aEnd = getEndDate(a) || getStartDate(a) || new Date(8640000000000000);
    const bEnd = getEndDate(b) || getStartDate(b) || new Date(8640000000000000);
    return aEnd - bEnd;
  });

  notStartedTasks.sort((a, b) => {
    const aStart = getStartDate(a) || new Date(8640000000000000);
    const bStart = getStartDate(b) || new Date(8640000000000000);
    return aStart - bStart;
  });

  endedTasks.sort((a, b) => (a.createdAt || a.id) - (b.createdAt || b.id));

  const actionsDisabledAttr = isAdmin ? '' : 'disabled';

  function rowHtml(task) {
    const timeTypeLabel = task.timeType === 'activity' ? '活动日期' : '截止日期';
    return `
      <tr>
        <td>${orderMap[task.id] || ''}</td>
        <td>
          <button class="link-like" onclick="showTaskDetail(${task.id})">${escapeHtml(task.event)}</button>
        </td>
        <td>${escapeHtml(task.target)}</td>
        <td>${timeTypeLabel}</td>
        <td>${formatTimeDetail(task)}</td>
        <td>
          <button class="action-btn edit-btn" onclick="editTask(${task.id})" ${actionsDisabledAttr}>修改</button>
          <button class="action-btn delete-btn" onclick="deleteTask(${task.id})" ${actionsDisabledAttr}>删除</button>
        </td>
      </tr>
    `;
  }

  tbodyInProgress.innerHTML = inProgressTasks.map(rowHtml).join('');
  tbodyNotStarted.innerHTML = notStartedTasks.map(rowHtml).join('');
  tbodyEnded.innerHTML = endedTasks.map(rowHtml).join('');

  countInProgress.textContent = inProgressTasks.length ? `共 ${inProgressTasks.length} 条` : '暂无进行中事项';
  countNotStarted.textContent = notStartedTasks.length ? `共 ${notStartedTasks.length} 条` : '暂无未开始事项';
  countEnded.textContent = endedTasks.length ? `共 ${endedTasks.length} 条` : '暂无已截止事项';
}

function showTaskDetail(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const timeTypeLabel = task.timeType === 'activity' ? '活动日期' : '截止日期';
  const timeText = formatTimeDetail(task);

  const lines = [
    `事项：${task.event || ''}`,
    `详情：${task.detail || ''}`,
    `面向对象：${task.target || ''}`,
    `时间类型：${timeTypeLabel}`,
    `时间：${timeText}`
  ];

  alert(lines.join('\n'));
}

// ==== 导入 / 导出 Excel ====
function triggerImport() {
  if (!ensureAdmin()) return;
  document.getElementById('importFile').click();
}

async function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      json.forEach(row => {
        const eventName = row['事项'] || row['事件'] || '';
        if (!eventName) return;

        const target = row['面向对象'] || 'ALL';
        const detail = row['详情'] || '';
        const timeTypeText = row['时间类型'] || '截止日期';
        const timeType = timeTypeText.includes('活动') ? 'activity' : 'deadline';

        const activityDate = row['活动日期'] || '';
        const activityStartTime = row['开始时间'] || '';
        const activityEndTime = row['结束时间'] || '';
        const deadlineDate = row['截止日期'] || '';
        const deadlineTime = row['截止时间'] || '';

        const taskData = {
          event: String(eventName).trim(),
          target: String(target).trim() || 'ALL',
          detail: String(detail).trim(),
          timeType,
          activityDate: '',
          activityStartTime: '',
          activityEndTime: '',
          deadlineDate: '',
          deadlineTime: ''
        };

        if (timeType === 'activity') {
          taskData.activityDate = activityDate;
          taskData.activityStartTime = activityStartTime;
          taskData.activityEndTime = activityEndTime;
        } else {
          taskData.deadlineDate = deadlineDate;
          taskData.deadlineTime = deadlineTime;
        }

        const newTask = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          createdAt: Date.now(),
          ...taskData
        };
        tasks.push(newTask);
      });

      // 先保存到本地
      localStorage.setItem('tasks_v2', JSON.stringify(tasks));
      renderTable();

      // 然后同步到 GitHub
      if (githubConfig && githubConfig.githubOwner && githubConfig.githubRepo) {
        try {
          await saveToGitHub();
          alert('导入完成并已同步到 GitHub');
        } catch (error) {
          alert('导入完成，但同步到 GitHub 失败');
        }
      } else {
        alert('导入完成');
      }
    } catch (err) {
      console.error(err);
      alert('导入失败，请确认 Excel 格式是否正确。');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

function exportTasks() {
  if (!tasks || tasks.length === 0) {
    alert('当前没有可导出的事项');
    return;
  }

  const data = [
    ['事项', '面向对象', '详情', '时间类型', '活动日期', '开始时间', '结束时间', '截止日期', '截止时间']
  ];

  tasks.forEach(task => {
    const row = [
      task.event || '',
      task.target || '',
      task.detail || '',
      task.timeType === 'activity' ? '活动日期' : '截止日期',
      task.activityDate || '',
      task.activityStartTime || '',
      task.activityEndTime || '',
      task.deadlineDate || '',
      task.deadlineTime || ''
    ];
    data.push(row);
  });

  const worksheet = XLSX.utils.aoa_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '事项列表');
  XLSX.writeFile(workbook, '事项列表.xlsx');
}

// HTML转义，防止XSS攻击
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

