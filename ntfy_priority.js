const NAMED_PRIORITIES = new Set(["min", "low", "high", "max"]);

function normalizeNtfyPriority(rawValue) {
  const value = String(rawValue ?? "").trim().toLowerCase();
  if (!value || value === "default") return undefined;
  if (/^[1-5]$/.test(value)) return Number(value);
  if (NAMED_PRIORITIES.has(value)) return value;
  return undefined;
}

function buildNtfyPayload({ topic, title, message, priority, tags }) {
  // 主动消息默认以“芯”署名；避免模型只给一行正文时显示通用的“来自AI”。
  const displayTitle = !title || String(title).trim() === "来自AI"
    ? "芯"
    : String(title).trim();
  const payload = { topic, title: displayTitle, message };
  const normalizedPriority = normalizeNtfyPriority(priority);
  if (normalizedPriority !== undefined) payload.priority = normalizedPriority;
  const normalizedTags = String(tags ?? "").split(",").map(tag => tag.trim()).filter(Boolean);
  if (normalizedTags.length) payload.tags = normalizedTags;
  return payload;
}

module.exports = { buildNtfyPayload, normalizeNtfyPriority };
