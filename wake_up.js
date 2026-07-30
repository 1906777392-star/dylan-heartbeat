require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { buildNtfyPayload } = require("./ntfy_priority");

const TIMELINE_PATH = path.join(__dirname, "enhanced_messages.json");
const FORCE_WAKE_TEST_MARKER_PATH = path.join(__dirname, ".wake_prompt_test_sent");
const GUARANTEED_STARTUP_TEST_MARKER_PATH = path.join(__dirname, ".guaranteed_startup_push_sent");
const PORT = Number(process.env.PORT) || 3000;
const GATEWAY_BASE_URL = (process.env.GATEWAY_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const GATEWAY_URL = `${GATEWAY_BASE_URL}/internal/wake-event`;
const HEARTBEAT_URL = `${GATEWAY_BASE_URL}/internal/heartbeat`;
const TIME_ZONE = process.env.TIME_ZONE || "Europe/London";
const WEATHER_TIMEOUT_MS = 5000;
const DIARY_DIR_NAME = process.env.DIARY_DIR || "diary";
const DIARY_DIR_PATH = path.isAbsolute(DIARY_DIR_NAME)
  ? DIARY_DIR_NAME
  : path.join(__dirname, DIARY_DIR_NAME);

function readNumberEnv(key, fallback, options = {}) {
  const value = Number(process.env[key]);
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  if (Number.isFinite(value) && value >= min && value <= max) return value;
  return fallback;
}

function readBooleanEnv(key, fallback = false) {
  const raw = String(process.env[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function getDatePartsInTimeZone(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute
  };
}

function getDiaryDateString(date = new Date()) {
  const parts = getDatePartsInTimeZone(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getDiaryTimeString(date = new Date()) {
  const parts = getDatePartsInTimeZone(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function extractDiaryFromResponse(text) {
  const diaryBlocks = [];
  const remainingText = String(text || "").replace(/\[DIARY\]([\s\S]*?)\[\/DIARY\]/gi, (_, content) => {
    const diary = String(content || "").trim();
    if (diary) diaryBlocks.push(diary);
    return "";
  }).trim();
  return { diaryContent: diaryBlocks.join("\n\n").trim(), remainingText };
}

function appendDiaryEntry(content) {
  if (!readBooleanEnv("DIARY_ENABLED", true)) return false;
  const cleanContent = String(content || "").trim();
  if (!cleanContent) return false;
  fs.mkdirSync(DIARY_DIR_PATH, { recursive: true });
  const diaryFile = path.join(DIARY_DIR_PATH, `${getDiaryDateString()}.md`);
  fs.appendFileSync(diaryFile, `\n\n## ${getDiaryTimeString()}\n\n${cleanContent}\n`, "utf-8");
  console.log(`已保存日记：${diaryFile}`);
  return true;
}

async function sendPushNotification({ title, body }) {
  const provider = (process.env.PUSH_PROVIDER || "bark").trim().toLowerCase();
  if (provider === "ntfy") {
    const topic = String(process.env.NTFY_TOPIC || "").trim();
    if (!topic) return { ok: false, providerLabel: "ntfy", reason: "NTFY_TOPIC 未配置" };
    const server = (process.env.NTFY_SERVER_URL || "https://ntfy.sh").replace(/\/+$/, "");
    const headers = { "Content-Type": "application/json" };
    if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
    const response = await fetch(server, {
      method: "POST",
      headers,
      body: JSON.stringify(buildNtfyPayload({
        topic,
        title,
        message: body,
        priority: process.env.NTFY_PRIORITY,
        tags: process.env.NTFY_TAGS
      }))
    });
    const responseText = await response.text();
    return response.ok
      ? { ok: true, providerLabel: "ntfy" }
      : { ok: false, providerLabel: "ntfy", reason: responseText || `HTTP ${response.status}` };
  }
  if (provider !== "bark") return { ok: false, providerLabel: provider || "未知渠道", reason: `不支持的 PUSH_PROVIDER：${provider}` };
  if (!process.env.BARK_KEY) return { ok: false, providerLabel: "Bark", reason: "Bark Key 未配置" };
  const response = await fetch("https://api.day.app/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, device_key: process.env.BARK_KEY, icon: process.env.CUSTOM_ICON_URL })
  });
  const text = await response.text();
  let result = {};
  try { result = JSON.parse(text); } catch {}
  return (!response.ok || (result.code && result.code !== 200))
    ? { ok: false, providerLabel: "Bark", reason: result.message || `HTTP ${response.status}` }
    : { ok: true, providerLabel: "Bark" };
}

// 2026-07-30：仅用于本次修复验证。部署后绕过时间线、模型和唤醒条件，直接走已配置的推送渠道发送一次。
// 这样若仍收不到，就能确定问题在 ntfy 配置/订阅，而不是 Kelivo 或模型唤醒逻辑。
async function sendGuaranteedStartupTest() {
  if (fs.existsSync(GUARANTEED_STARTUP_TEST_MARKER_PATH)) return;
  try {
    const result = await sendPushNotification({
      title: "芯",
      body: "我在。现在是我主动来找你。"
    });
    if (result.ok) {
      fs.writeFileSync(GUARANTEED_STARTUP_TEST_MARKER_PATH, new Date().toISOString(), "utf-8");
      console.log(`已发送一次启动测试 ${result.providerLabel} 推送`);
    } else {
      console.error(`启动测试 ${result.providerLabel} 推送失败：${result.reason}`);
    }
  } catch (err) {
    console.error("启动测试推送异常：", err.message);
  }
}

function isDayTime(date = new Date()) {
  const hour = date.getHours();
  const start = readNumberEnv("WAKE_DAY_START_HOUR", 10, { min: 0, max: 23 });
  const end = readNumberEnv("WAKE_DAY_END_HOUR", 24, { min: 1, max: 24 });
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}
function getWakeAfterMinutes(date = new Date()) { return isDayTime(date) ? readNumberEnv("DAY_WAKE_AFTER_MINUTES", 60, { min: 1 }) : readNumberEnv("NIGHT_WAKE_AFTER_MINUTES", 120, { min: 1 }); }
function getCheckIntervalMinutes(date = new Date()) { return isDayTime(date) ? readNumberEnv("DAY_CHECK_INTERVAL_MINUTES", 10, { min: 1 }) : readNumberEnv("NIGHT_CHECK_INTERVAL_MINUTES", 120, { min: 1 }); }
function normalizeContentToText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) return content.map(part => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
    if (type === "text" || type === "input_text") return part.text || part.content || "";
    if (part.image_url || type.includes("image")) return "[图片]";
    if (part.file || type.includes("file")) return "[文件]";
    return "";
  }).filter(Boolean).join("\n");
  if (content && typeof content === "object") {
    const type = typeof content.type === "string" ? content.type.toLowerCase() : "";
    if (content.image_url || type.includes("image")) return "[图片]";
    if (content.file || type.includes("file")) return "[文件]";
  }
  return "[非文本内容]";
}
function summarizeWakeMessages(messages = []) {
  const roles = {}; let chars = 0;
  for (const msg of messages) { roles[msg?.role || ""] = (roles[msg?.role || ""] || 0) + 1; chars += normalizeContentToText(msg?.content).length; }
  return { total: messages.length, roles, text_chars: chars };
}
function weatherCodeText(code) { return ({ 0: "晴朗", 1: "大致晴朗", 2: "局部多云", 3: "阴天", 45: "有雾", 48: "雾凇", 51: "小毛毛雨", 53: "中等毛毛雨", 55: "较强毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨", 71: "小雪", 73: "中雪", 75: "大雪", 80: "阵雨", 81: "较强阵雨", 82: "强阵雨", 95: "雷暴", 96: "雷暴伴小冰雹", 99: "雷暴伴大冰雹" })[code] || `天气代码 ${code}`; }
async function fetchWeatherContext() {
  if (!readBooleanEnv("WEATHER_ENABLED", false)) return "";
  const lat = Number(process.env.WEATHER_LAT), lon = Number(process.env.WEATHER_LON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  const location = process.env.WEATHER_LOCATION_NAME || "当前位置";
  const units = (process.env.WEATHER_UNITS || "metric").trim().toLowerCase();
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat)); url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m");
  url.searchParams.set("daily", "sunrise,sunset"); url.searchParams.set("timezone", "auto"); url.searchParams.set("forecast_days", "1");
  url.searchParams.set("temperature_unit", units === "fahrenheit" ? "fahrenheit" : "celsius"); url.searchParams.set("wind_speed_unit", units === "fahrenheit" ? "mph" : "kmh");
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(), current = data.current || {}, daily = data.daily || {}, unit = data.current_units || {};
    const lines = ["## 天气信息", `- 位置：${location}`, `- 当前：${weatherCodeText(current.weather_code)}，${current.temperature_2m}${unit.temperature_2m || "°C"}，体感 ${current.apparent_temperature}${unit.apparent_temperature || "°C"}`, `- 湿度：${current.relative_humidity_2m}${unit.relative_humidity_2m || "%"}`, `- 降雨：${current.precipitation}${unit.precipitation || "mm"}`, `- 风速：${current.wind_speed_10m}${unit.wind_speed_10m || ""}`];
    if (Array.isArray(daily.sunrise) && Array.isArray(daily.sunset)) lines.push(`- 日出/日落：${daily.sunrise[0]} / ${daily.sunset[0]}`);
    return lines.join("\n");
  } catch (err) { console.log("天气注入失败，跳过本次天气信息:", err.message); return ""; } finally { clearTimeout(timeout); }
}
function loadTimelineMessages() {
  if (!fs.existsSync(TIMELINE_PATH)) { console.log("未找到 enhanced_messages.json"); return null; }
  try { const parsed = JSON.parse(fs.readFileSync(TIMELINE_PATH, "utf-8")); return Array.isArray(parsed) ? parsed : null; } catch (err) { console.error("读取 enhanced_messages.json 失败:", err.message); return null; }
}
function getChinaTimeString() { return new Date().toLocaleString("zh-CN", { timeZone: TIME_ZONE }); }
function getLocalTimeString() { const now = new Date(), p = n => String(n).padStart(2, "0"); return `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`; }
function isOneShotWakePromptTest() { return Boolean(String(process.env.WAKE_PROMPT_TEMPLATE || "").trim()) && !fs.existsSync(FORCE_WAKE_TEST_MARKER_PATH); }
function markOneShotWakePromptTestSent() { try { fs.writeFileSync(FORCE_WAKE_TEST_MARKER_PATH, new Date().toISOString(), "utf-8"); } catch {} }
function parseTimelineTimestamp(value) { const m = String(value || "").match(/（?\s*(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[ T]?)(\d{1,2})[:：](\d{2})/); if (!m) return null; const [, y,,mo,d,h,mi] = m; const result = new Date(`${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")} ${String(h).padStart(2,"0")}:${mi}`); return Number.isNaN(result.getTime()) ? null : result; }
function getLastUserTime(messages) { for (const msg of [...messages].reverse()) if (msg.role === "user") { const time = parseTimelineTimestamp(normalizeContentToText(msg.content)); if (time) return time; } return null; }
function shouldWake(lastUserTime) { if (isOneShotWakePromptTest()) return true; return Math.floor((new Date() - lastUserTime) / 60000) >= getWakeAfterMinutes(new Date()); }
function stripPosition(messages) { return messages.map(({ position, ...rest }) => rest); }
function buildWakePrompt(currentTime, diffMinutes, weatherContext = "") {
  const promptFile = path.join(__dirname, "wake_prompt.txt");
  const template = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, "utf-8") : (process.env.WAKE_PROMPT_TEMPLATE || `## 最高优先级规则\n这是一次后台自动唤醒。决定是否主动联系用户。\n\n当前时间：${currentTime}\n距离用户最后一条消息：${diffMinutes} 分钟\n${weatherContext}\n\n想联系就直接写消息；不想联系只输出：[NO_ACTION]。`);
  return template.replace(/\\n/g, "\n").replace(/\$\{currentTime\}/g, currentTime).replace(/\$\{diffMinutes\}/g, diffMinutes).replace(/\$\{weatherContext\}/g, weatherContext).replace(/\$\{weather\}/g, weatherContext);
}
async function runWakeUp() {
  console.log("\n开始自动唤醒\n");
  const messages = loadTimelineMessages(); if (!messages) return;
  const lastUserTime = getLastUserTime(messages); if (!lastUserTime) { console.log("未找到用户时间"); return; }
  const diffMinutes = Math.floor((new Date() - lastUserTime) / 60000); if (!shouldWake(lastUserTime)) { console.log("暂不需要唤醒"); return; }
  const weatherContext = await fetchWeatherContext(), cleanMessages = stripPosition(messages), wakePrompt = buildWakePrompt(getChinaTimeString(), diffMinutes, weatherContext);
  const historyText = cleanMessages.filter(m => m.role !== "system").filter(m => { const c = normalizeContentToText(m.content); return !c.includes("<memories>") && !c.includes("记忆库使用策略"); }).map(m => `[${m.role === "user" ? (process.env.USER_DISPLAY_NAME || "用户") : (process.env.AI_DISPLAY_NAME || "AI")}] ${normalizeContentToText(m.content).split("## Memories")[0]}`).join("\n\n");
  const sp = cleanMessages.find(m => m.role === "system"), cleanSP = sp ? normalizeContentToText(sp.content).split("## Memories")[0].trim() : "";
  const wakeMessages = [{ role: "system", content: [wakePrompt, cleanSP].filter(Boolean).join("\n\n") }, { role: "user", content: `以下是最近聊天记录，仅供回忆。用户现在没有发新消息。\n\n${historyText}` }];
  console.log(JSON.stringify(summarizeWakeMessages(wakeMessages)));
  if (!process.env.TARGET_API_URL || !process.env.TARGET_API_KEY || !process.env.MODEL_NAME) { console.log("缺少 TARGET_API_URL / TARGET_API_KEY / MODEL_NAME"); return; }
  const response = await fetch(process.env.TARGET_API_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TARGET_API_KEY}` }, body: JSON.stringify({ model: process.env.MODEL_NAME, messages: wakeMessages, temperature: 0.8, top_p: 0.95, stream: false }) });
  const responseText = await response.text(); let data; try { data = JSON.parse(responseText); } catch { throw new Error(`模型返回的不是 JSON（HTTP ${response.status}）：${responseText.slice(0,300)}`); } if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）：${responseText.slice(0,300)}`);
  const diaryResult = extractDiaryFromResponse(normalizeContentToText(data.choices?.[0]?.message?.content).trim()), diarySaved = appendDiaryEntry(diaryResult.diaryContent), aiText = diaryResult.remainingText;
  let eventContent;
  if (!aiText) eventContent = diarySaved ? `（${getLocalTimeString()} 自动唤醒：本次未发送推送｜原因：只写日记）` : `（${getLocalTimeString()} 自动唤醒：本次未发送推送｜原因：模型空回复）`;
  else if (/^\[NO_ACTION\]/.test(aiText)) eventContent = `（${getLocalTimeString()} 自动唤醒：本次未发送推送）`;
  else {
    let text = aiText; const tagged = text.match(/\[BARK\]([\s\S]*?)\[\/BARK\]/); if (tagged) text = tagged[1].trim();
    const lines = text.replace(/^标题[：:]\s*/gm, "").replace(/^正文[：:]\s*/gm, "").split("\n").filter(Boolean);
    if (!lines.length) eventContent = `（${getLocalTimeString()} 自动唤醒：本次未发送推送｜原因：推送内容为空）`;
    else {
      let title = lines.length === 1 ? "来自AI" : lines[0].trim(), body = lines.length === 1 ? lines[0].trim() : lines.slice(1).join(" ").trim();
      const result = await sendPushNotification({ title: title || "来自伴侣", body: body.slice(0, 500) });
      if (!result.ok) eventContent = `（${getLocalTimeString()} 自动唤醒：本次未发送推送｜原因：${result.providerLabel} 推送失败：${result.reason}）`;
      else { if (isOneShotWakePromptTest()) markOneShotWakePromptTestSent(); eventContent = `（${getLocalTimeString()} 刚刚给用户发了${result.providerLabel}推送：${title}｜${body}）`; }
    }
  }
  try { const res = await fetch(GATEWAY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: eventContent }) }); if (!res.ok) throw new Error(`Gateway 返回 HTTP ${res.status}`); } catch (err) { console.error("记录唤醒事件失败：", err.message); }
}
function getCheckIntervalMs() { return getCheckIntervalMinutes(new Date()) * 60000; }
async function scheduleNextCheck() { try { try { await fetch(HEARTBEAT_URL, { method: "POST" }); } catch {} await runWakeUp(); } catch (err) { console.error("唤醒检查出错:", err); } setTimeout(scheduleNextCheck, getCheckIntervalMs()); }
setTimeout(sendGuaranteedStartupTest, 5_000);
setTimeout(scheduleNextCheck, 10_000);
console.log("Dylan Heartbeat Runtime 已启动（动态间隔）");
