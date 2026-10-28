```
DON'T FORGET TO FORK 🍴 & STAR 🌟 OUR REPO🫠
```
---

> **CURRENT BOT VERSION ➜ `1.1.1 ⚡`**
---

<a href="https://git.io/typing-svg">
  <img src="https://readme-typing-svg.demolab.com?font=Black+Ops+One&size=50&pause=1000&color=1BAFBAFF&center=true&width=1200&height=100&lines=HEY%20DEAR%20WELCOME;TOO%20CBS-SCOVER%20BOT%20REPO;MULTI%20DEVICE%20WHATSAPP%20BOT;CREATED%20BY%20CYRILIX-XMD" alt="Typing SVG" />
</a>


<p align="center">
  <a href="https://chat.whatsapp.com/GAlNHmy9FxZ90YXdxgzdu5?s=cl&p=a&mlu=4">
    <img alt=Support weight="10" src="https://ik.imagekit.io/amir2008/26dda0fb-dd5d-41df-ad98-32f0004af588.png?updatedAt=1787431052164"> 
    </p>
<p align="center"> 
    </p>
<p align="center">
  <a aria-label="Join our chats" href="https://chat.whatsapp.com/GAlNHmy9FxZ90YXdxgzdu5?s=cl&p=a&mlu=4" target="_blank">
    <img alt="whatsapp" src="https://img.shields.io/badge/Join Group chat-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" />
    <a align="center">
  <a aria-label="Follow Channel" href="https://whatsapp.com/channel/0029Vb8CfvXDjiOVpsJpdW3j" target="_blank">
    <img alt="whatsapp" src="https://img.shields.io/badge/Follow Channel-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" />
</a>
<a aria-label="Chat me" href="https://t.me/cbsscover" target="_blank">
    <img alt="telegram" src="https://img.shields.io/badge/Telegram Group-24A1DE?style=for-the-badge&logo=telegram&logoColor=white" />
  </a>
</p>  
   
 ---
## FIRST FORK THE REPOSITORY
` CLICK THE FORK BUTTON BELOW `

<a href="https://github.com/codebreakers/CBS-SCOVER/fork"><img title="CBS-SCOVER" src="https://img.shields.io/badge/FORK-BOT%20REPO-h?color=indigo&style=for-the-badge&logo=stackshare"></a>
  
## GET SESSION ID BELOW
> **FROM PAIRING WEB**

<a href='https://codebreakers.uk' target="_blank">
  <img alt='Pairing Code' src='https://img.shields.io/badge/Get%20Pairing%20Code-orange?style=for-the-badge&logo=opencv&logoColor=black'/>
</a>
<br> 


## DEPLOYMENT METHODS
- Upload SESSION_ID (creds.json) on session folder or add it to your .env file: SESSION_ID=
- Edit .env to your Choice.

### API configuration (Node.js 22)

The bot loads the repository's `.env` even when launched from another directory.
Hosting-panel values take precedence. Restart after changing keys; keep your session
folder. `.env.example` lists blank slots: do not overwrite your existing `.env` with it.

- **Chat:** `GEMINI_API_KEY` (or `GEMINI_KEY_1`) and `GEMINI_KEY_2` through `GEMINI_KEY_5`.
  `GOOGLE_API_KEY` is accepted only when the first chat slot is empty.
  `GEMINI_CHAT_MODEL` overrides the chat model; `GEMINI_VIDEO_MODEL` overrides video analysis.
- **Image generation:** `IMAGE_GEMINI_KEY_1` through `IMAGE_GEMINI_KEY_5`
  (`IMAGE_GEMINI_KEY` is accepted as slot 1). This pool is separate from chat and
  video keys and never borrows them. `IMAGE_GEMINI_MODEL` overrides the model id
  (default: `gemini-3.1-flash-image`, the Flash 3 image model).
- **Video analysis only:** `GEMINI_YOUTUBE_KEY_1` through `GEMINI_YOUTUBE_KEY_5`, or `GEMINI_youtube_KEY` and `GEMINI_youtube_KEY_2` through
  `GEMINI_youtube_KEY_5`. Hyphen aliases (`GEMINI_youtube_KEY-2` through `-5`) and
  legacy uppercase names also work. This pool never borrows chat keys.
  Move any old `VIDEO_KNOWLEDGE_GEMINI_API_KEY` value to this new pool.
- **YouTube searches:** `YOUTUBE_API_KEY` with YouTube Data API v3 enabled.
  Gemini video keys analyse metadata; they are not YouTube search credentials.
  Song/video details are sent immediately after a bounded metadata search (three-second
  target); search and WhatsApp delivery cannot be guaranteed. Audio follows once ready.
  `.video <title>` searches Dailymotion; unrelated results are rejected. `.video` also
  accepts public Dailymotion (`dai.ly` included) and YouTube links. `.ytmp4` retains
  YouTube title search. Music/`.play` providers are unchanged. Source catalogs differ:
  a song missing from Dailymotion requires a public matching video link.
  Video downloads use `youtube-dl-exec`'s installed yt-dlp directly, not the failing
  third-party MP4 services. Install dependencies on the host after updating; Python 3
  must be available for the downloader. The official YouTube API cannot download
  media or remove YouTube server-IP, age, private-video or verification restrictions.
- **Voice conversion:** `HF_TOKEN` from Hugging Face; `HUGGINGFACE_TOKEN` and
  `HF_API_TOKEN` are accepted aliases. Public Spaces may work without a token,
  but private Spaces require access and ZeroGPU quotas still apply.
  `HF_SPACE=Plachta/Seed-VC` selects the default compatible Space; `owner/space`
  and Hugging Face Space webpage URLs are accepted.

Leave unused slots blank. Never commit `.env` or share credentials. Invalid numeric
voice settings use safe defaults. Google API enablement, restrictions, billing,
quota and model availability can still cause provider errors; configuration cannot
override them. A different Seed-VC Space must offer the same `/predict` schema.

Official references:
- **Authorization recovery (checked October 24, 2026):** Google now rejects unrestricted standard Gemini keys; restrict them to the Generative Language API or create new auth keys in AI Studio. Blocked, leaked, invalid or revoked keys need replacement. New AI Studio keys default to auth keys. Check the linked service account, enabled API and server-IP restrictions if access still fails. Update the hosting panel too: old panel values override replacement values in `.env`. Restart without deleting the WhatsApp session. See [current AI Studio key guidance](https://aistudio.google.com/docs/api-key).
- A Hugging Face `401` from `/api/whoami-v2` means the configured token is not accepted; replace it in [token settings](https://huggingface.co/settings/tokens). A valid token must also have access to the selected Seed-VC Space. This bot uses Gradio Spaces, not the retired serverless inference hostname; changing to the Inference Providers router would not fix its voice conversion. Inference Providers permissions apply only if using that separate API.
- [Gemini keys](https://ai.google.dev/gemini-api/docs/api-key)
- [YouTube API setup](https://developers.google.com/youtube/v3/getting-started)
- [Hugging Face tokens](https://huggingface.co/docs/hub/security-tokens)
- [Gradio JavaScript client](https://www.gradio.app/docs/js-client)

---

## FOR PANEL DEPLOYMENT
Run `npm start` with Node.js 22 or newer. Startup now runs one bot process,
not a second nested copy. The existing 320 MB V8 heap ceiling does not limit
total memory: media buffers and native libraries also count against the panel's
RAM allocation. Do not raise the heap ceiling without checking the plan limit.

The console prints `[HOST]` memory/uptime readings every five minutes and logs
host shutdown signals and normal exit codes. If the server stops, save the last
console lines and the panel's termination reason: `137`/`SIGKILL` can indicate
a forced kill (check the panel's OOM flag), `143`/`SIGTERM` indicates a requested
stop, and `JavaScript heap out of memory` indicates Node's heap ceiling. SIGKILL
and container-wide OOM kills cannot be caught or restarted from inside the bot.
Panel sleep schedules, expired hosting credit and suspension require changes
in the panel; configure its automatic crash restart if available. A keep-alive
page cannot override those policies or guarantee year-long uptime.

- Click on **[DOWNLOAD](https://github.com/codebreakers/CBS-SCOVER/archive/refs/heads/main.zip)** to get zip file🗃.
- Create a server on your panel
- Upload zip file 🗃️
- Unzip it and others
- Start server
---

## OTHER DEPLOYMENT PLATFORMS
- **Deploy on [Bot-Hosting.Net](https://bot-hosting.net/)** ***Free***
- **Deploy on [Render](https://render.com)** ***Free***
- **Deploy on [Katabump](https://dashboard.katabump.com/auth/login)** ***Free***
- **Deploy on [Optiklink](https://optiklink.com/)** ***Free***
- **Deploy on [Heroku](https://dashboard.heroku.com/new?template=https://github.com/codebreakers/CBS-SCOVER)** ***Paid***
- **Deploy on [codebreakers-Host](https://codebreakers.uk)** ***Paid***
- **Deploy on [Prince-Host](https://host.princetechn.com/deploy-bot/CBS-SCOVER)** ***Paid***
---

## FOR TERMUX/SSH/UBUNTU
```
Before inputting these commands in termux... You have to extract the bot file in your internal storage. (Downloads folder)

apt update && apt upgrade
pkg update && pkg upgrade
pkg install bash
pkg install git -y
pkg install nodejs -y 
pkg install ffmpeg -y 
pkg install wget
pkg install imagemagick -y
pkg install yarn
termux-setup-storage
cd /storage/emulated/0/Download/CBS-SCOVER-main
yarn install
npm start
```
---

## FOR STARTING TERMUX AGAIN
```
cd /storage/emulated/0/Download/CBS-SCOVER-main
npm start
```
---

## FOR 24/7 ACTIVATION TERMUX/SSH/UBUNTU
```
bash
npm i -g pm2 && pm2 start index.js && pm2 save && pm2 logs
Paste this after the installation
```
---

<p align="left">  
  <!-- Website -->
  <a href="https://codebreakers.uk" target="_blank" aria-label="CBS-SCOVER Website">  
    <img alt="CBS-SCOVER Website" src="https://img.shields.io/badge/CBS-SCOVER WEB-25D366?style=for-the-badge&logo=internetexplorer&logoColor=white" />  
  </a>  

  <!-- Other Repo -->
  <a href="https://github.com/codebreakers/Elite-Pro-V2" target="_blank" aria-label="Other Repo">  
    <img alt="Other Repo" src="https://img.shields.io/badge/OTHER REPO-0E1241?style=for-the-badge&logo=github&logoColor=white" />  
  </a>  

  <!-- YouTube -->
  <a href="https://www.youtube.com/@codebreakers" target="_blank" aria-label="Subscribe on YouTube">  
    <img alt="YouTube Channel" src="https://img.shields.io/badge/Subscribe-FF0000?style=for-the-badge&logo=youtube&logoColor=white" />  
  </a>  
</p>

 --- 
- Star ⭐ repo if you like this bot.
