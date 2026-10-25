/**
 * 用药提醒助手 - 核心逻辑
 * 支持铃声、震动、弹窗三种提醒方式
 * 可自定义间隔天数
 */

(function () {
    'use strict';

    // ==================== DOM 元素 ====================
    const els = {
        nextReminderTime: document.getElementById('nextReminderTime'),
        countdown: document.getElementById('countdown'),
        medicineNameDisplay: document.getElementById('medicineNameDisplay'),
        medicineName: document.getElementById('medicineName'),
        intervalDays: document.getElementById('intervalDays'),
        reminderTime: document.getElementById('reminderTime'),
        notifySound: document.getElementById('notifySound'),
        notifyVibrate: document.getElementById('notifyVibrate'),
        notifyPopup: document.getElementById('notifyPopup'),
        volumeSlider: document.getElementById('volumeSlider'),
        volumeValue: document.getElementById('volumeValue'),
        saveSettings: document.getElementById('saveSettings'),
        testReminder: document.getElementById('testReminder'),
        historyList: document.getElementById('historyList'),
        markTaken: document.getElementById('markTaken'),
        clearHistory: document.getElementById('clearHistory'),
        reminderOverlay: document.getElementById('reminderOverlay'),
        reminderTitle: document.getElementById('reminderTitle'),
        reminderMessage: document.getElementById('reminderMessage'),
        btnTaken: document.getElementById('btnTaken'),
        btnSnooze: document.getElementById('btnSnooze'),
    };

    // ==================== 默认设置 ====================
    const DEFAULT_SETTINGS = {
        medicineName: '',
        intervalDays: 3,
        reminderTime: '08:00',
        notifySound: true,
        notifyVibrate: true,
        notifyPopup: true,
        volume: 70,
        startDate: getTodayStr(),
        lastTakenDate: null,
        history: [],
    };

    // ==================== 状态 ====================
    let settings = loadSettings();
    let reminderTimer = null;
    let countdownTimer = null;
    let audioContext = null;
    let snoozeMinutes = 0;

    // ==================== 初始化 ====================
    function init() {
        applySettings();
        renderHistory();
        startReminderCheck();
        startCountdownUpdate();
        bindEvents();
        requestNotificationPermission();
        registerServiceWorker();
    }

    // ==================== 数据持久化 ====================
    function loadSettings() {
        try {
            const saved = localStorage.getItem('medicine_reminder_settings');
            if (saved) {
                return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('加载设置失败，使用默认设置');
        }
        return { ...DEFAULT_SETTINGS };
    }

    function saveSettings() {
        try {
            localStorage.setItem('medicine_reminder_settings', JSON.stringify(settings));
        } catch (e) {
            console.warn('保存设置失败');
        }
    }

    // ==================== 应用设置到界面 ====================
    function applySettings() {
        els.medicineName.value = settings.medicineName;
        els.intervalDays.value = settings.intervalDays;
        els.reminderTime.value = settings.reminderTime;
        els.notifySound.checked = settings.notifySound;
        els.notifyVibrate.checked = settings.notifyVibrate;
        els.notifyPopup.checked = settings.notifyPopup;
        els.volumeSlider.value = settings.volume;
        els.volumeValue.textContent = settings.volume + '%';
        updateNextReminderDisplay();
    }

    // ==================== 事件绑定 ====================
    function bindEvents() {
        els.saveSettings.addEventListener('click', handleSaveSettings);
        els.testReminder.addEventListener('click', handleTestReminder);
        els.markTaken.addEventListener('click', handleMarkTaken);
        els.clearHistory.addEventListener('click', handleClearHistory);
        els.btnTaken.addEventListener('click', handleTakenFromReminder);
        els.btnSnooze.addEventListener('click', handleSnooze);
        els.volumeSlider.addEventListener('input', function () {
            els.volumeValue.textContent = this.value + '%';
        });
        els.reminderOverlay.addEventListener('click', function (e) {
            if (e.target === els.reminderOverlay) {
                hideReminder();
            }
        });

        // 页面可见性变化时重新检查
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                updateNextReminderDisplay();
            }
        });
    }

    // ==================== 保存设置 ====================
    function handleSaveSettings() {
        settings.medicineName = els.medicineName.value.trim();
        settings.intervalDays = Math.max(1, parseInt(els.intervalDays.value) || 1);
        settings.reminderTime = els.reminderTime.value || '08:00';
        settings.notifySound = els.notifySound.checked;
        settings.notifyVibrate = els.notifyVibrate.checked;
        settings.notifyPopup = els.notifyPopup.checked;
        settings.volume = parseInt(els.volumeSlider.value) || 70;

        saveSettings();
        updateNextReminderDisplay();
        startReminderCheck();
        showToast('✅ 设置已保存', 'success');
    }

    // ==================== 计算下次提醒时间 ====================
    function getNextReminderTime() {
        if (!settings.startDate) {
            settings.startDate = getTodayStr();
            saveSettings();
        }

        const now = new Date();
        const startDate = new Date(settings.startDate + 'T00:00:00');
        const [hours, minutes] = (settings.reminderTime || '08:00').split(':').map(Number);

        // 如果还没有服用记录，从今天开始
        if (!settings.lastTakenDate) {
            const todayReminder = new Date();
            todayReminder.setHours(hours, minutes, 0, 0);
            if (todayReminder <= now) {
                // 今天已经过了提醒时间，看是否应该今天提醒
                const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
                if (daysSinceStart >= 0 && daysSinceStart % settings.intervalDays === 0) {
                    // 今天应该吃药，如果还没过今天，就设置今天
                    return todayReminder;
                }
            }
            // 找下一个应该吃药的日期
            return findNextDoseDate(now, startDate, hours, minutes);
        }

        // 上次服药日期
        const lastTaken = new Date(settings.lastTakenDate + 'T00:00:00');

        // 下次服药日期 = 上次服药日期 + 间隔天数
        const nextDoseDate = new Date(lastTaken);
        nextDoseDate.setDate(nextDoseDate.getDate() + settings.intervalDays);

        // 设置提醒时间
        const nextReminder = new Date(nextDoseDate);
        nextReminder.setHours(hours, minutes, 0, 0);

        // 如果已过，再加一个间隔
        if (nextReminder <= now) {
            const addDays = Math.ceil((now - nextReminder) / (1000 * 60 * 60 * 24) / settings.intervalDays) * settings.intervalDays;
            nextReminder.setDate(nextReminder.getDate() + addDays);
        }

        return nextReminder;
    }

    function findNextDoseDate(fromDate, startDate, hours, minutes) {
        const checkDate = new Date(fromDate);
        checkDate.setHours(0, 0, 0, 0);

        const startDay = new Date(startDate);
        startDay.setHours(0, 0, 0, 0);

        let daysSinceStart = Math.floor((checkDate - startDay) / (1000 * 60 * 60 * 24));
        // 确保我们从今天开始找
        const remainder = daysSinceStart % settings.intervalDays;

        let nextDate;
        if (remainder === 0) {
            nextDate = new Date(checkDate);
        } else {
            nextDate = new Date(checkDate);
            nextDate.setDate(nextDate.getDate() + (settings.intervalDays - remainder));
        }

        // 检查这个日期在今天是否已经过了提醒时间
        const now = new Date();
        const candidate = new Date(nextDate);
        candidate.setHours(hours, minutes, 0, 0);

        if (candidate <= now) {
            // 设置到下一个间隔
            nextDate.setDate(nextDate.getDate() + settings.intervalDays);
        }

        nextDate.setHours(hours, minutes, 0, 0);
        return nextDate;
    }

    // ==================== 更新界面显示 ====================
    function updateNextReminderDisplay() {
        const nextTime = getNextReminderTime();
        const now = new Date();

        els.nextReminderTime.textContent = formatDateTime(nextTime);

        if (settings.medicineName) {
            els.medicineNameDisplay.textContent = '💊 ' + settings.medicineName;
            els.medicineNameDisplay.style.display = 'inline-block';
        } else {
            els.medicineNameDisplay.style.display = 'none';
        }

        updateCountdown(nextTime);
    }

    function updateCountdown(nextTime) {
        const now = new Date();
        const diff = nextTime - now;

        if (diff <= 0) {
            els.countdown.textContent = '⏰ 提醒时间已到！';
            els.countdown.style.color = '#fff';
            // 触发提醒
            triggerReminder(false);
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        let text = '距离下次提醒还有 ';
        if (days > 0) text += days + '天 ';
        if (hours > 0) text += hours + '小时 ';
        text += minutes + '分钟 ' + seconds + '秒';

        els.countdown.textContent = text;
        els.countdown.style.color = '#fff';
    }

    function startCountdownUpdate() {
        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = setInterval(updateNextReminderDisplay, 1000);
    }

    // ==================== 提醒检查 ====================
    function startReminderCheck() {
        if (reminderTimer) clearInterval(reminderTimer);
        // 每30秒检查一次
        reminderTimer = setInterval(function () {
            const nextTime = getNextReminderTime();
            const now = new Date();
            const diff = nextTime - now;

            // 在提醒时间前后1分钟内触发
            if (diff <= 60000 && diff >= -60000 && !isReminderActive()) {
                triggerReminder(true);
            }

            updateNextReminderDisplay();
        }, 30000);
    }

    function isReminderActive() {
        return els.reminderOverlay.classList.contains('show');
    }

    // ==================== 触发提醒 ====================
    function triggerReminder(autoTrigger) {
        const message = settings.medicineName
            ? '该吃「' + settings.medicineName + '」了！'
            : '该吃药了！请按时服药。';

        // 弹窗提醒
        if (settings.notifyPopup) {
            showReminderPopup(message);
        }

        // 铃声提醒
        if (settings.notifySound) {
            playAlertSound();
        }

        // 震动提醒
        if (settings.notifyVibrate) {
            vibrate();
        }

        // 浏览器通知
        if (autoTrigger && Notification.permission === 'granted') {
            try {
                new Notification('💊 用药提醒', {
                    body: message,
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💊</text></svg>',
                    tag: 'medicine-reminder',
                    requireInteraction: true,
                    vibrate: settings.notifyVibrate ? [200, 100, 200] : [],
                });
            } catch (e) {
                console.warn('浏览器通知失败:', e);
            }
        }
    }

    function showReminderPopup(message) {
        els.reminderMessage.textContent = message;
        els.reminderTitle.textContent = snoozeMinutes > 0 ? '💊 再次提醒吃药' : '💊 该吃药啦！';
        els.reminderOverlay.classList.add('show');

        // 阻止页面滚动
        document.body.style.overflow = 'hidden';
    }

    function hideReminder() {
        els.reminderOverlay.classList.remove('show');
        document.body.style.overflow = '';
        stopAlertSound();
        snoozeMinutes = 0;
    }

    // ==================== 已服药 ====================
    function handleTakenFromReminder() {
        const now = new Date();
        settings.lastTakenDate = getTodayStr();
        settings.history.push({
            date: getTodayStr(),
            time: formatTime(now),
            medicine: settings.medicineName || '药品',
            timestamp: now.getTime(),
        });
        saveSettings();
        hideReminder();
        stopAlertSound();
        updateNextReminderDisplay();
        renderHistory();
        showToast('✅ 已记录服药，下次提醒已更新', 'success');
    }

    function handleMarkTaken() {
        const now = new Date();
        const today = getTodayStr();

        // 检查今天是否已经记录
        const todayRecord = settings.history.find(function (h) {
            return h.date === today;
        });

        if (todayRecord) {
            showToast('⚠️ 今天已经记录过了', 'error');
            return;
        }

        settings.lastTakenDate = today;
        settings.history.push({
            date: today,
            time: formatTime(now),
            medicine: settings.medicineName || '药品',
            timestamp: now.getTime(),
        });
        saveSettings();
        updateNextReminderDisplay();
        renderHistory();
        hideReminder();
        stopAlertSound();
        showToast('✅ 已记录服药！', 'success');
    }

    // ==================== 稍后提醒 ====================
    function handleSnooze() {
        hideReminder();
        stopAlertSound();
        snoozeMinutes += 10;

        setTimeout(function () {
            triggerReminder(false);
        }, 10 * 60 * 1000);

        showToast('⏰ 将在10分钟后再次提醒', 'success');
    }

    // ==================== 测试提醒 ====================
    function handleTestReminder() {
        // 临时更新音量
        settings.volume = parseInt(els.volumeSlider.value) || 70;
        settings.notifySound = els.notifySound.checked;
        settings.notifyVibrate = els.notifyVibrate.checked;
        settings.notifyPopup = els.notifyPopup.checked;

        triggerReminder(false);
        showToast('🔔 正在测试提醒...', 'success');
    }

    // ==================== 铃声播放 ====================
    function playAlertSound() {
        try {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // 恢复被浏览器挂起的 AudioContext
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }

            const volume = settings.volume / 100;
            playMelody(audioContext, volume);
        } catch (e) {
            console.warn('音频播放失败:', e);
        }
    }

    function playMelody(ctx, vol) {
        // 播放一段悦耳的提醒旋律
        const notes = [
            { freq: 523.25, duration: 0.15, gap: 0.05 },  // C5
            { freq: 659.25, duration: 0.15, gap: 0.05 },  // E5
            { freq: 783.99, duration: 0.3, gap: 0.1 },    // G5
            { freq: 659.25, duration: 0.15, gap: 0.05 },  // E5
            { freq: 783.99, duration: 0.5, gap: 0.2 },    // G5
        ];

        let startTime = ctx.currentTime;

        notes.forEach(function (note) {
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(note.freq, startTime);

            gainNode.gain.setValueAtTime(vol * 0.5, startTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + note.duration);

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            oscillator.start(startTime);
            oscillator.stop(startTime + note.duration);

            startTime += note.duration + note.gap;
        });

        // 存储 oscillator 引用以便停止
        window._alertStartTime = startTime;
    }

    function stopAlertSound() {
        try {
            if (audioContext) {
                audioContext.close();
                audioContext = null;
            }
        } catch (e) {
            // 忽略
        }
    }

    // ==================== 震动 ====================
    function vibrate() {
        if (navigator.vibrate) {
            // 震动模式：震200ms 停100ms 震200ms 停100ms 震400ms
            navigator.vibrate([200, 100, 200, 100, 400]);
        }
    }

    // ==================== 服药记录渲染 ====================
    function renderHistory() {
        if (!settings.history || settings.history.length === 0) {
            els.historyList.innerHTML = '<p class="empty-hint">还没有服药记录</p>';
            return;
        }

        // 按时间倒序，最近的在上面
        const sorted = settings.history.slice().sort(function (a, b) {
            return (b.timestamp || 0) - (a.timestamp || 0);
        });

        els.historyList.innerHTML = sorted.map(function (record) {
            return '<div class="history-item">' +
                '<span class="date">' + record.date + '</span>' +
                '<span class="time">' + record.time + '</span>' +
                '<span class="medicine">' + (record.medicine || '药品') + '</span>' +
                '</div>';
        }).join('');
    }

    function handleClearHistory() {
        if (settings.history.length === 0) {
            showToast('没有可清除的记录', 'error');
            return;
        }

        if (confirm('确定要清空所有服药记录吗？此操作不可恢复。')) {
            settings.history = [];
            settings.lastTakenDate = null;
            saveSettings();
            renderHistory();
            updateNextReminderDisplay();
            showToast('🗑️ 记录已清空', 'success');
        }
    }

    // ==================== 通知权限 ====================
    function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            // 延迟请求，避免页面加载时打扰
            setTimeout(function () {
                Notification.requestPermission().then(function (permission) {
                    if (permission === 'granted') {
                        console.log('通知权限已授予');
                    }
                });
            }, 3000);
        }
    }

    // ==================== Service Worker ====================
    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(function (registration) {
                    console.log('Service Worker 注册成功:', registration.scope);
                })
                .catch(function (error) {
                    console.warn('Service Worker 注册失败:', error);
                });
        }
    }

    // ==================== Toast 提示 ====================
    function showToast(message, type) {
        // 移除旧 toast
        var oldToast = document.querySelector('.toast');
        if (oldToast) oldToast.remove();

        var toast = document.createElement('div');
        toast.className = 'toast ' + (type || '');
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(function () {
            toast.style.animation = 'toastOut 0.3s ease forwards';
            setTimeout(function () {
                toast.remove();
            }, 300);
        }, 2000);
    }

    // ==================== 工具函数 ====================
    function getTodayStr() {
        var d = new Date();
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function formatDateTime(date) {
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        var hours = String(date.getHours()).padStart(2, '0');
        var minutes = String(date.getMinutes()).padStart(2, '0');
        var weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        var weekday = weekdays[date.getDay()];
        return year + '年' + month + '月' + day + '日 周' + weekday + ' ' + hours + ':' + minutes;
    }

    function formatTime(date) {
        return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    }

    // ==================== 启动应用 ====================
    init();
})();