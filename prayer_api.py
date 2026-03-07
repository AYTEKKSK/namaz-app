"""
Namaz Vakitleri API - Blueprint (Standalone)
"""
from flask import Blueprint, jsonify, request
import requests
from datetime import datetime

prayer_bp = Blueprint('prayer_api', __name__)


# No-op decorators (standalone app - no auth needed)
def login_required(f):
    return f


def api_app_enabled_required(app_name):
    def decorator(f):
        return f
    return decorator


def _normalize_prayer_time(raw_time):
    if not raw_time:
        return ''
    return str(raw_time).split(' ')[0].strip()


@prayer_bp.route('/prayer-times')
def api_prayer_times():
    """Konuma göre günlük namaz vakitleri"""
    try:
        latitude = request.args.get('lat', type=float)
        longitude = request.args.get('lon', type=float)
        date_str = request.args.get('date', '').strip()

        if latitude is None or longitude is None:
            return jsonify({'success': False, 'error': 'lat ve lon parametreleri gerekli'}), 400

        if latitude < -90 or latitude > 90 or longitude < -180 or longitude > 180:
            return jsonify({'success': False, 'error': 'Geçersiz koordinat'}), 400

        if date_str:
            try:
                target_date = datetime.strptime(date_str, '%Y-%m-%d')
            except ValueError:
                return jsonify({'success': False, 'error': 'date formatı YYYY-MM-DD olmalı'}), 400
        else:
            target_date = datetime.now()

        calendar_resp = requests.get(
            'https://api.aladhan.com/v1/calendar',
            params={
                'latitude': latitude,
                'longitude': longitude,
                'method': 13,
                'month': target_date.month,
                'year': target_date.year
            },
            timeout=12
        )
        calendar_resp.raise_for_status()
        calendar_json = calendar_resp.json()

        day_list = calendar_json.get('data') or []
        if len(day_list) < target_date.day:
            return jsonify({'success': False, 'error': 'Namaz vakti verisi alınamadı'}), 502

        day_data = day_list[target_date.day - 1]
        timings = day_data.get('timings', {})

        prayer_times = {
            'imsak': _normalize_prayer_time(timings.get('Fajr')),
            'gunes': _normalize_prayer_time(timings.get('Sunrise')),
            'ogle': _normalize_prayer_time(timings.get('Dhuhr')),
            'ikindi': _normalize_prayer_time(timings.get('Asr')),
            'aksam': _normalize_prayer_time(timings.get('Maghrib')),
            'yatsi': _normalize_prayer_time(timings.get('Isha'))
        }

        location_name = ''
        try:
            location_resp = requests.get(
                'https://nominatim.openstreetmap.org/reverse',
                params={
                    'format': 'jsonv2',
                    'lat': latitude,
                    'lon': longitude,
                    'zoom': 10
                },
                headers={'User-Agent': 'namaz-standalone/1.0'},
                timeout=8
            )
            if location_resp.ok:
                loc_json = location_resp.json()
                addr = loc_json.get('address', {})
                city = addr.get('city') or addr.get('town') or addr.get('state_district') or addr.get('state')
                country = addr.get('country')
                location_name = ', '.join([part for part in [city, country] if part])
        except Exception:
            location_name = ''

        date_info = day_data.get('date', {})
        now = datetime.now()
        prayer_sequence = [
            ('imsak', 'İmsak'),
            ('gunes', 'Güneş'),
            ('ogle', 'Öğle'),
            ('ikindi', 'İkindi'),
            ('aksam', 'Akşam'),
            ('yatsi', 'Yatsı')
        ]

        next_prayer = None
        remaining_seconds = None
        if target_date.date() == now.date():
            for key, label in prayer_sequence:
                value = prayer_times.get(key)
                if not value or ':' not in value:
                    continue
                hour, minute = value.split(':')
                prayer_dt = datetime(now.year, now.month, now.day, int(hour), int(minute))
                if prayer_dt > now:
                    next_prayer = {'key': key, 'name': label, 'time': value}
                    remaining_seconds = int((prayer_dt - now).total_seconds())
                    break

        return jsonify({
            'success': True,
            'coordinates': {'lat': latitude, 'lon': longitude},
            'location': {
                'name': location_name,
                'timezone': (day_data.get('meta') or {}).get('timezone', 'Europe/Istanbul')
            },
            'date': {
                'gregorian': (date_info.get('gregorian') or {}).get('date', target_date.strftime('%d-%m-%Y')),
                'hijri': (date_info.get('hijri') or {}).get('date', '')
            },
            'timings': prayer_times,
            'nextPrayer': next_prayer,
            'remainingSeconds': remaining_seconds,
            'source': 'aladhan'
        })
    except requests.RequestException as e:
        return jsonify({'success': False, 'error': f'Namaz vakit servisi hatası: {str(e)}'}), 502
    except Exception as e:
        return jsonify({'success': False, 'error': f'Namaz vakitleri alınamadı: {str(e)}'}), 500


# ── Push notification stub endpoints ─────────────────────────────────────────

@prayer_bp.route('/push/vapid-public-key')
def push_vapid_public_key():
    """Push API stub - not implemented in standalone mode"""
    return jsonify({'success': False, 'error': 'Push notifications not available in standalone mode'}), 501


@prayer_bp.route('/push/subscribe', methods=['POST'])
def push_subscribe():
    """Push subscribe stub - not implemented in standalone mode"""
    return jsonify({'success': False, 'error': 'Push notifications not available in standalone mode'}), 501


@prayer_bp.route('/push/unsubscribe', methods=['POST'])
def push_unsubscribe():
    """Push unsubscribe stub"""
    return jsonify({'success': False, 'error': 'Push notifications not available in standalone mode'}), 501
