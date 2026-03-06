"""
Namaz Vakitleri - Standalone Flask App - Port 5055
https://app.articnc.online/namaz
"""
import os
import sys

# Change to app directory so relative paths work
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# UTF-8 output fix for Windows
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

from flask import Flask, render_template, send_from_directory
from prayer_api import prayer_bp

app = Flask(__name__, template_folder='templates')
app.secret_key = 'namaz-standalone-secret'

# Register blueprint with /api prefix
app.register_blueprint(prayer_bp, url_prefix='/api')

@app.route('/')
def index():
    return render_template('index.html')

# Also serve at /namaz/ when accessed via reverse proxy
@app.route('/namaz')
@app.route('/namaz/')
def index_namaz():
    return render_template('index.html')

@app.after_request
def add_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


# ── PWA ──────────────────────────────────────────
@app.route('/manifest.json')
def pwa_manifest():
    return send_from_directory(app.static_folder, 'manifest.json',
                               mimetype='application/manifest+json')

@app.route('/sw.js')
def pwa_sw():
    resp = send_from_directory(app.static_folder, 'sw.js',
                               mimetype='application/javascript')
    resp.headers['Service-Worker-Allowed'] = '/'
    return resp
# ─────────────────────────────────────────────────

if __name__ == '__main__':
    print("==> Namaz Vakitleri başlatılıyor: http://localhost:5055")
    print("==> Proxy üzerinden: https://app.articnc.online/namaz")
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5055)), debug=False, use_reloader=False)
