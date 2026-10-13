# Try TWCommute on your Android phone

The backend runs on a Linux computer at home and the app runs on your Android phone on the same Wi-Fi. Pick one region:

- **Hsinchu** (`hsinchu`): Hsinchu City, Zhubei with HSR Hsinchu station, Baoshan with the Science Park, Zhudong and Zhunan. It uses about 1.2 GB of memory while running.
- **Greater Taipei** (`taipei`): Taipei, New Taipei, Keelung and Tamsui. It uses about 3.5 GB while running and needs 4 GB free to build.

All of Taiwan needs a 16 GB server, so this setup covers one region at a time. The steps below use Hsinchu; for Taipei, type `taipei` instead of `hsinchu`.

**Backend on a server the phone can't reach directly?** For example, a headless Ubuntu server you manage over SSH. Do steps 1–3 on the server, then connect the phone [through your laptop](#server-elsewhere-connect-through-your-laptop-ssh-tunnel).

## What you need

- **A Linux computer:** Ubuntu, Linux Mint or Debian, with 8 GB of RAM and 5 GB of free disk, on your home Wi-Fi or network.
- **An Android phone:** Android 7 or newer, 64-bit (almost every phone since 2017), on the **same Wi-Fi**.
- **Your TDX key:** `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET`, from <https://tdx.transportdata.tw/user/dataservice/key>.
- **The app file:** `TWCommute-1.0.0.apk`, sent to you in the chat.

## 1. Install the tools

Open a terminal on the computer (Ctrl+Alt+T). For a server, connect to it from your laptop instead: `ssh you@your-server` (on Windows, in PowerShell). Then run:

```bash
sudo apt update
sudo apt install -y git curl osmium-tool
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

**Close the terminal and open a new one**, then:

```bash
nvm install 22
corepack enable
node -v
```

`node -v` should print `v22.` followed by more numbers. From here on, don't use `sudo`: the script refuses to run as root, because under `sudo` it can't find the Node you just installed.

## 2. Get the code and add your TDX key

```bash
cd ~
git clone --branch claude/eager-lovelace-70z86n https://github.com/wislibot/TWCommute.git
cd TWCommute
cp .env.example .env
nano .env
```

In `nano`:
1. Put your key after `TDX_CLIENT_ID=` and `TDX_CLIENT_SECRET=`, with no spaces or quotes.
2. Save with Ctrl+O, then Enter.
3. Exit with Ctrl+X.

**For a server reached through an SSH tunnel,** also add this line, which keeps the app's API on the server only:

```
API_HOST=127.0.0.1
```

`.env` stays on your computer; git never uploads it.

## 3. Start the backend

```bash
infra/scripts/try-it.sh hsinchu
```

The first run does everything in one go:
- installs the code's packages, about 1 GB;
- downloads about 1.15 GB: timetables 466 MB, the Taiwan map 349 MB, OpenTripPlanner 191 MB and Java 140 MB;
- trims the data to Hsinchu and builds the route graph;
- starts the live data.

After the downloads, the rest took 6 minutes when tested. When it's done it prints:

```
== Ready: Hsinchu
In the app: Settings -> Server, enter:  http://192.168.1.20:3000
```

Write down that address; yours will be different. The backend keeps running after the script ends, so you can close the terminal.

With `API_HOST=127.0.0.1` it prints the SSH tunnel command for your laptop instead: continue [there](#server-elsewhere-connect-through-your-laptop-ssh-tunnel).

**If the phone connects to this computer directly and its firewall is on** (Ubuntu: `sudo ufw status` says `Status: active`), let the phone in:

```bash
sudo ufw allow 3000/tcp
```

**Check it from the phone:** open `http://<that address>/v1/health` in the phone's browser. You should see a short text starting with `{"status":"ok"`. If the page doesn't load, see [Troubleshooting](#troubleshooting).

## 4. Install the app

1. **Get the file onto the phone.** The easiest way is to open this chat in the Claude app on your phone and download `TWCommute-1.0.0.apk`. You can also copy it over with a USB cable or a messaging app.
2. **Open the file.** Android asks once to allow installing apps from this source (your browser, Files or the Claude app): allow it, go back, and tap **Install**.
3. **If Google Play Protect warns about an unknown app,** tap **More details → Install anyway**. The app is signed with a test key, not a Play Store key.

## 5. Point the app at your computer

1. Open TWCommute and allow location.
2. Tap **⚙** (top right of the home screen).
3. Under **Server**, type the address from step 3, for example `http://192.168.1.20:3000`, and tap **Save**.

## Server elsewhere: connect through your laptop (SSH tunnel)

Use this when the backend runs on a server the phone can't reach directly. The phone talks to your laptop, and the laptop forwards to the server over SSH:

```
phone ──Wi-Fi──▶ laptop, port 3000 ──SSH──▶ server (the API listens on the server only)
```

**On the server**, over SSH:
- Do steps 1–3 with `API_HOST=127.0.0.1` in `.env`. The server then needs no open port except SSH, so skip the firewall step.
- When it's ready, the script prints the tunnel command to run on your laptop.
- The backend keeps running after you log out. After the server reboots, SSH in and run `infra/scripts/try-it.sh`.

**On the Windows laptop**, in PowerShell (Windows 10 and 11 include `ssh`):

1. **Start the tunnel**, and keep this window open while you use the app. It prints nothing while it works.
   ```
   ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -L 0.0.0.0:3000:127.0.0.1:3000 you@your-server
   ```
   Add `-p 2222` (your port) if the server's SSH doesn't use port 22.
2. **Let the phone in.**
   - Set your Wi-Fi to **Private**: Settings → Network & internet → Wi-Fi → (your network) → Network profile type → Private.
   - The first time, Windows Firewall asks about `ssh.exe` (OpenSSH SSH client): allow it on **private networks**.
   - No prompt, or still blocked? Open PowerShell **as administrator** and run:
     ```
     New-NetFirewallRule -DisplayName "TWCommute tunnel" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
     ```
3. **Find the laptop's address:** run `ipconfig` and look under **Wireless LAN adapter Wi-Fi** for **IPv4 Address**, e.g. `192.168.1.35`.
4. **Check it.**
   - In the laptop's browser, open `http://localhost:3000/v1/health`. It should show `{"status":"ok"…`.
   - Then open `http://192.168.1.35:3000/v1/health` in the phone's browser.
5. **In the app:** Settings → Server → `http://192.168.1.35:3000` → Save.

**Keeping it working:**
- Keep the laptop awake while you use the app: Settings → System → Power → Sleep → Never, while testing.
- If the tunnel window closes (the laptop slept, or the Wi-Fi changed), run the command again.
- If the laptop's address changes, update the app.

| What you see | What to do |
| --- | --- |
| `bind [0.0.0.0]:3000: Address already in use` | Something on the laptop already uses port 3000. Use `-L 0.0.0.0:3001:127.0.0.1:3000`, port 3001 in the app, and `-LocalPort 3001` in the firewall rule. |
| `channel 2: open failed: connect failed: Connection refused` in the tunnel window | The backend isn't running on the server: SSH in and run `infra/scripts/try-it.sh status`. |
| It works on the laptop (`localhost`) but not on the phone | Your Wi-Fi is set to Public, or the firewall rule is missing. The phone must also be on the laptop's Wi-Fi. |

## 6. What to try in Hsinchu

| Try | What you should see |
| --- | --- |
| 新竹火車站 → 清華大學 | City buses 182 and 藍線1區, intercity buses 5608 and 9003, or YouBike |
| 新竹火車站 → 高鐵新竹站 | The Liujia line train (about 30 minutes) |
| 竹北火車站 → 新竹縣政府 | Bus 65A or 快捷1號, or YouBike |
| 新竹火車站 → 新竹科學園區, or → 竹東 | Buses 182 or 5608 |
| A day with a stop: 新竹火車站 → 城隍廟 (stay 60 minutes) → 南寮漁港 | The plan keeps your stay, then continues |
| Departure boards: 新竹轉運站, 新竹火車站, 高鐵新竹站 | Each time is labelled *Live* or *Scheduled*; trains show live delays |
| Settings → TPASS → 桃竹竹苗 | City and county buses say *covered*; YouBike is not covered |
| Settings → language | 繁體中文, English, 日本語 and 한국어 |

## 7. Daily use

| Command (in `~/TWCommute`) | What it does |
| --- | --- |
| `infra/scripts/try-it.sh` | Start the region you used last, e.g. after a reboot (about 2–3 minutes) |
| `infra/scripts/try-it.sh stop` | Stop everything |
| `infra/scripts/try-it.sh status` | What is running, how the phone connects (directly or through an SSH tunnel), and how fresh each live feed is |
| `infra/scripts/try-it.sh rebuild` | Download fresh timetables and rebuild (do this weekly) |

The computer must stay on and awake. Turn off automatic suspend (Settings → Power), and don't close a laptop's lid. After a reboot, run the first command again. Logs are in `data/run/`.

**To update to a newer version:**

```bash
cd ~/TWCommute
infra/scripts/try-it.sh stop
git pull
infra/scripts/try-it.sh rebuild
```

A new app version comes as a new `.apk`: install it over the old one.

**To switch region:** `infra/scripts/try-it.sh taipei` builds Taipei from the files already downloaded, then starts it. `infra/scripts/try-it.sh hsinchu` switches back, which only restarts because Hsinchu is already built.

## What this setup can't do yet

- **One region at a time.** Trips must start and end inside it. Trains to Taipei or Taichung appear on departure boards, but trips to places outside the region can't be planned.
- **Live data within the free TDX plan.** The plan allows 5 requests a minute, and Hsinchu uses about 4.2 of them for Hsinchu City and County buses, 41 intercity routes, YouBike and TRA delays. So run only one backend with your TDX key. Not every bus reports live times, and high-speed rail times come from the timetable.
- **Partial TPASS checks.** For intercity buses and trains, TPASS shows *may be covered*: those are not yet checked station by station.
- **Same Wi-Fi only.** Guest networks and routers with "AP isolation" or "client isolation" stop the phone from reaching the computer.
- **First run on a real phone.** The app has been built and checked on a computer, not yet on a phone. Screenshots of anything odd help.

## Troubleshooting

**The app says "Can't reach the TWCommute server".**
1. Run `infra/scripts/try-it.sh status`: it should list ingest, otp and api as `running`.
2. Make sure the phone is on the same Wi-Fi, not on mobile data.
3. Check the firewall (step 3).
4. Check whether the computer's address changed, which is common after a reboot. Run `hostname -I`, then update Settings → Server.
5. On the computer, `curl http://localhost:3000/v1/health` should answer.

**Script error messages:**

| Message | What to do |
| --- | --- |
| `Ingest cannot start: TDX rejected the key` | Fix `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` in `.env`, then run the script again. |
| `Ingest did not start within 420 s` | See `data/run/ingest.log`. `429` means another program is using the same TDX key. |
| `Graph build failed` | See `data/run/build.log`, then run `infra/scripts/try-it.sh hsinchu` again. `rebuild` downloads everything fresh. |
| `Warning: only … MB of memory is available` | Close other programs (e.g. the web browser) and run it again. |
| `Run this as your normal user` | Run it without `sudo`. |
| `node is not installed` or `pnpm is not installed` | Open a new terminal, or run `nvm use 22` and `corepack enable`. |

**The map opens on Taipei.** Allow location for TWCommute in the phone's settings. The map starts on Taipei until it knows where you are.
