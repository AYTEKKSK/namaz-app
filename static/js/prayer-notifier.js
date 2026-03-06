/**
 * PrayerNotifier — manages geolocation, prayer time fetching, and alarm scheduling.
 * Exposes window.PrayerNotifier
 */
(function (window) {
    'use strict';

    var STORAGE_KEY = 'prayerNotifierState';
    var ALARM_KEY   = 'prayer_alarm_minutes';
    var API_BASE    = ''; // App lives at root on its own subdomain

    var _state = {
        location:    null,   // { lat, lon }
        prayerData:  null,
        enabled:     false
    };

    var _callbacks = {
        onUpdate: null,
        onError:  null,
        onNotify: null
    };

    var _alarmTimeout   = null;
    var _exactTimeout   = null;
    var _refreshInterval = null;

    /* ---------------------------------------------------------------
       Persistence helpers
    --------------------------------------------------------------- */
    function _loadState() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && parsed.location) {
                    _state.location = parsed.location;
                }
            }
        } catch (e) { /* ignore */ }
    }

    function _saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ location: _state.location }));
        } catch (e) { /* ignore */ }
    }

    /* ---------------------------------------------------------------
       Alarm helpers
    --------------------------------------------------------------- */
    function _getAlarmMinutes() {
        var val = parseInt(localStorage.getItem(ALARM_KEY), 10);
        return isNaN(val) ? 10 : val; // default 10 minutes
    }

    function _cancelAlarm() {
        if (_alarmTimeout) { clearTimeout(_alarmTimeout); _alarmTimeout = null; }
        if (_exactTimeout)  { clearTimeout(_exactTimeout);  _exactTimeout  = null; }
    }

    function _scheduleAlarm(prayerName, prayerTime, remainingSeconds) {
        _cancelAlarm();

        var alarmMinutes = _getAlarmMinutes();
        var remaining    = Math.max(0, Number(remainingSeconds) || 0);

        // Advance warning
        if (alarmMinutes > 0) {
            var advanceDelaySec = remaining - alarmMinutes * 60;
            if (advanceDelaySec > 0) {
                _alarmTimeout = setTimeout(function () {
                    _fireAlarm(prayerName, prayerTime, alarmMinutes);
                }, advanceDelaySec * 1000);
            }
        }

        // Exact prayer time notification
        if (remaining > 0) {
            _exactTimeout = setTimeout(function () {
                _fireExactAlarm(prayerName, prayerTime);
            }, remaining * 1000);
        }
    }

    async function _showNotification(title, opts) {
        try {
            if ('serviceWorker' in navigator) {
                var reg = await navigator.serviceWorker.getRegistration();
                if (reg) {
                    await reg.showNotification(title, opts);
                    return;
                }
            }
            new Notification(title, opts); // eslint-disable-line no-new
        } catch (e) {
            console.warn('PrayerNotifier: notification error', e);
        }
    }

    async function _fireAlarm(prayerName, prayerTime, alarmMinutes) {
        var msg  = prayerName + ' vaktine ' + alarmMinutes + ' dakika kaldı';
        var body = prayerName + ' ' + (prayerTime || '') + ' – ' + alarmMinutes + ' dk kaldı';

        window.dispatchEvent(new CustomEvent('prayer-alert', {
            detail: { kind: 'advance', message: msg, prayerTime: prayerTime, minutesBefore: alarmMinutes }
        }));

        if ('Notification' in window && Notification.permission === 'granted') {
            await _showNotification('🕌 ' + prayerName + ' Yaklaşıyor', {
                body:             body,
                icon:             '/static/icon-192.svg',
                badge:            '/static/icon-192.svg',
                vibrate:          [200, 100, 200],
                tag:              'prayer-alarm-' + prayerName,
                requireInteraction: true
            });
            if (_callbacks.onNotify) { _callbacks.onNotify({ prayerName: prayerName, body: body, kind: 'advance' }); }
        }
    }

    async function _fireExactAlarm(prayerName, prayerTime) {
        var msg  = prayerName + ' vakti girdi!';
        var body = prayerName + ' ' + (prayerTime || '') + ' – hayırlı namazlar 🤲';

        window.dispatchEvent(new CustomEvent('prayer-alert', {
            detail: { kind: 'exact', message: msg, prayerTime: prayerTime }
        }));

        if ('Notification' in window && Notification.permission === 'granted') {
            await _showNotification('🕌 ' + prayerName + ' Vakti', {
                body:             body,
                icon:             '/static/icon-192.svg',
                badge:            '/static/icon-192.svg',
                vibrate:          [300, 100, 300, 100, 300],
                tag:              'prayer-exact-' + prayerName,
                requireInteraction: true
            });
            if (_callbacks.onNotify) { _callbacks.onNotify({ prayerName: prayerName, body: body, kind: 'exact' }); }
        }
    }

    /* ---------------------------------------------------------------
       Public API
    --------------------------------------------------------------- */
    var PrayerNotifier = {

        /* Initialize with callbacks */
        init: function (callbacks) {
            _callbacks.onUpdate = (callbacks && callbacks.onUpdate) || null;
            _callbacks.onError  = (callbacks && callbacks.onError)  || null;
            _callbacks.onNotify = (callbacks && callbacks.onNotify) || null;
            _loadState();
        },

        /* Return a copy of internal state */
        getState: function () {
            return {
                location:   _state.location ? Object.assign({}, _state.location) : null,
                enabled:    _state.enabled,
                prayerData: _state.prayerData
            };
        },

        /* Detect current geolocation and cache it */
        detectLocation: function () {
            return new Promise(function (resolve, reject) {
                if (!navigator.geolocation) {
                    reject(new Error('Tarayıcınız konum desteklemiyor'));
                    return;
                }
                navigator.geolocation.getCurrentPosition(
                    function (pos) {
                        _state.location = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                        _saveState();
                        resolve(_state.location);
                    },
                    function (err) {
                        reject(new Error('Konum alınamadı: ' + (err.message || err.code)));
                    },
                    { timeout: 12000, maximumAge: 300000 }
                );
            });
        },

        /* Fetch prayer times from backend and schedule alarms */
        refreshPrayerTimes: async function () {
            if (!_state.location) {
                throw new Error('Konum bilgisi yok. Önce konum alınmalı.');
            }

            var lat = encodeURIComponent(_state.location.lat);
            var lon = encodeURIComponent(_state.location.lon);
            var url = API_BASE + '/api/prayer-times?lat=' + lat + '&lon=' + lon;

            var response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error('Namaz vakitleri API hatası: ' + response.status);
            }

            var data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Vakitler alınamadı');
            }

            _state.prayerData = data;

            /* Schedule alarms */
            if (data.nextPrayer && data.remainingSeconds > 0) {
                _scheduleAlarm(data.nextPrayer.name, data.nextPrayer.time, data.remainingSeconds);
            }

            if (_callbacks.onUpdate) { _callbacks.onUpdate(data); }

            return data;
        },

        /* Request browser notification permission */
        requestNotificationPermission: async function () {
            if (!('Notification' in window)) {
                throw new Error('Bu tarayıcı bildirimleri desteklemiyor');
            }
            var perm = await Notification.requestPermission();
            return perm;
        },

        /* Play a short audio preview */
        playPreviewSound: async function () {
            try {
                var AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) { return; }
                var ctx  = new AudioCtx();
                var osc  = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = 800;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0, ctx.currentTime);
                gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02);
                gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.6);
                await new Promise(function (r) { setTimeout(r, 700); });
                ctx.close();
            } catch (e) {
                console.warn('PrayerNotifier: ses çalınamadı', e);
            }
        },

        /* Return security / notification diagnostics */
        getNotificationDiagnostics: function () {
            return {
                protocol:        window.location.protocol,
                isSecureContext: window.isSecureContext,
                permission:      ('Notification' in window) ? Notification.permission : 'unsupported'
            };
        },

        /* Try to boot from cached location stored in localStorage */
        bootFromStorage: async function (options) {
            _loadState();
            if (_state.location && typeof _state.location.lat === 'number') {
                try {
                    await PrayerNotifier.refreshPrayerTimes();
                    PrayerNotifier.enable();
                    return true;
                } catch (e) {
                    if (_callbacks.onError) { _callbacks.onError(e); }
                    return false;
                }
            }
            return false;
        },

        /* Start periodic refresh (every 5 minutes) */
        enable: function () {
            _state.enabled = true;
            if (_refreshInterval) { clearInterval(_refreshInterval); }
            _refreshInterval = setInterval(async function () {
                if (_state.location) {
                    try {
                        await PrayerNotifier.refreshPrayerTimes();
                    } catch (e) {
                        if (_callbacks.onError) { _callbacks.onError(e); }
                    }
                }
            }, 5 * 60 * 1000);
        },

        /* Alarm preference helpers */
        getAlarmMinutes: function () { return _getAlarmMinutes(); },

        setAlarmMinutes: function (minutes) {
            var mins = parseInt(minutes, 10);
            if (isNaN(mins)) { mins = 0; }
            localStorage.setItem(ALARM_KEY, String(mins));

            /* Reschedule with new preference */
            if (_state.prayerData && _state.prayerData.nextPrayer && _state.prayerData.remainingSeconds > 0) {
                _scheduleAlarm(
                    _state.prayerData.nextPrayer.name,
                    _state.prayerData.nextPrayer.time,
                    _state.prayerData.remainingSeconds
                );
            }
        }
    };

    window.PrayerNotifier = PrayerNotifier;

}(window));
