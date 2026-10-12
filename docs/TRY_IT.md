# Try TWCommute on your Android phone

The backend runs on a Linux computer at home and covers **Greater Taipei** (Taipei, New Taipei, Keelung, Tamsui). The app runs on an Android phone on the same Wi-Fi. All of Taiwan needs a 16 GB machine; Greater Taipei fits in 8 GB.

You need:

- a Linux computer with **8 GB of RAM** and **5 GB of free disk**, on your home Wi-Fi or network;
- an Android phone on the **same Wi-Fi**;
- your TDX API key (`TDX_CLIENT_ID` and `TDX_CLIENT_SECRET`).

## 1. Install the tools on the computer

Ubuntu or Debian:

```bash
sudo apt update && sudo apt install -y git curl osmium-tool
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# Close and reopen the terminal, then:
nvm install 22
corepack enable
```

On Fedora use `sudo dnf install git curl osmium-tool`. Java and OpenTripPlanner are downloaded by the script, so you don't install them.

## 2. Get the code and add your TDX key

```bash
git clone https://github.com/wislibot/TWCommute.git
cd TWCommute
git checkout claude/eager-lovelace-70z86n
cp .env.example .env
nano .env        # fill in TDX_CLIENT_ID and TDX_CLIENT_SECRET, then save (Ctrl+O, Enter, Ctrl+X)
```

`.env` stays on your computer; git ignores it.

## 3. Start the backend

```bash
infra/scripts/try-taipei.sh
```

The first run downloads about 1.1 GB (timetables 466 MB, the Taiwan map 349 MB, OpenTripPlanner 191 MB, Java 140 MB), trims them to Greater Taipei and builds the route graph. It took 10 minutes on a fast connection when tested; allow up to 30 on a slower one. When it is done it prints:

```
== Ready
In the app: Settings -> Server, enter:  http://192.168.1.20:3000
```

Write down that address. Your computer's IP will differ.

Check it from the phone: open `http://<that address>/v1/health` in the phone's browser. You should see a short JSON text starting with `{"status":`. If the page doesn't load, see [Troubleshooting](#troubleshooting).

Later:

| Command | What it does |
| --- | --- |
| `infra/scripts/try-taipei.sh start` | Start again, e.g. after a reboot (about 1–2 minutes) |
| `infra/scripts/try-taipei.sh stop` | Stop everything |
| `infra/scripts/try-taipei.sh status` | Show what is running |
| `infra/scripts/try-taipei.sh rebuild` | Download fresh timetables and rebuild (do this weekly) |

The running backend uses about 3.5 GB of memory. Logs are in `data/run/`.

## 4. Install the app

Open the APK link you were sent on the phone, download it, and open the file. Android asks once to allow installs from your browser or file manager: allow it, then install.

To build the APK yourself instead (free Expo account, 10–20 minutes on Expo's servers):

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init          # first time only: links the app to your Expo account
npx eas-cli@latest build -p android --profile preview
```

When the build finishes it prints a link and a QR code. Scan the QR code with the phone.

## 5. Point the app at your computer

In the app, tap the **gear** on the home screen, go to **Server**, type the address from step 3 (for example `http://192.168.1.20:3000`), and tap **Save**.

## 6. What to try

- **A day with stops:** plan Taipei Main Station → Tamsui, add a stop at Dihua Street (迪化街) for 90 minutes. The plan keeps your stay and continues afterwards.
- **YouBike:** plan a short trip in Taipei City with YouBike on, e.g. Taipei City Hall → Songshan Cultural and Creative Park. Bike legs warn when the pickup dock may be empty or the drop-off dock full, and suggest a backup station.
- **Stop boards:** tap a bus stop near you on the home screen. Each time is labelled *Live* or *Scheduled*.
- **TPASS:** in Settings, choose your pass (e.g. 基北北桃). Each option then says whether the pass covers it.
- **Languages:** switch between 繁體中文, English, 日本語 and 한국어 in Settings.

## What this setup can't do yet

- **Greater Taipei only.** Trips must start and end between Tamsui, Keelung, Sanxia and Xindian. Trains through the area keep all their stations, but there are no streets beyond the area.
- **Live data on the free TDX plan** (5 requests a minute) covers **Taipei City** buses and YouBike only. New Taipei and Keelung buses show timetable times. Metro times come from the timetable.
- **Same Wi-Fi only.** The phone reaches your computer only on your home network, and only while the computer is on and awake. Guest networks and some routers ("AP isolation" or "client isolation") block devices from reaching each other.
- **First run on a real phone.** The app was built and checked on a computer, not yet on a device. Screenshots of anything odd help.

## Troubleshooting

**The app says "Can't reach the TWCommute server".**
1. Is the backend running? `infra/scripts/try-taipei.sh status` should list three `running` lines.
2. Is the phone on the same Wi-Fi, not mobile data?
3. Is the computer's firewall blocking port 3000? With Ubuntu's firewall: `sudo ufw status`. If it says `active`, run `sudo ufw allow 3000/tcp`.
4. Did the computer's IP change (common after a reboot)? Run `hostname -I`, then update Settings → Server.

**The script stops with "… did not start within … s".** Look at the end of the log it names in `data/run/`:
- `ingest.log`: `401` or `invalid_client` means the TDX key in `.env` is wrong.
- `otp.log`: `OutOfMemoryError` means other programs are using too much memory. Close the web browser and run `start` again.

**The graph build fails.** See `data/run/build.log`. `rebuild` starts over.
