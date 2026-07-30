require("dotenv").config();

const Fastify = require("fastify");

const app = Fastify({ logger: true, bodyLimit: 2 * 1024 * 1024 });
const PORT = Number(process.env.PORT) || 3000;
const FISH_TTS_URL = "https://api.fish.audio/v1/tts";

function configuredClientKey() {
  return String(process.env.TTS_GATEWAY_KEY || process.env.GATEWAY_API_KEY || "").trim();
}

function requireClientKey(req, reply) {
  const expected = configuredClientKey();
  if (!expected) {
    reply.code(500).send({ error: { message: "TTS_GATEWAY_KEY 未配置", type: "configuration_error" } });
    return false;
  }
  const authorization = String(req.headers.authorization || "");
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const xApiKey = String(req.headers["x-api-key"] || "").trim();
  if (bearer === expected || xApiKey === expected) return true;
  reply.code(401).send({ error: { message: "语音桥 API Key 无效", type: "authentication_error" } });
  return false;
}

app.get("/health", async () => ({ ok: true, service: "fish-audio-openai-bridge" }));

// Kelivo 的 OpenAI TTS 提供方会调用此路径；本服务把 OpenAI 字段转换为 Fish Audio v1 TTS。
app.post("/v1/audio/speech", async (req, reply) => {
  if (!requireClientKey(req, reply)) return;

  const fishKey = String(process.env.FISH_API_KEY || "").trim();
  if (!fishKey) {
    return reply.code(500).send({ error: { message: "FISH_API_KEY 未配置", type: "configuration_error" } });
  }

  const body = req.body || {};
  const text = String(body.input || body.text || "").trim();
  const referenceId = String(body.voice || "").trim();
  const model = String(body.model || process.env.FISH_MODEL || "s2.1-pro-free").trim();

  if (!text) return reply.code(400).send({ error: { message: "缺少 input 文本", type: "invalid_request_error" } });
  if (!referenceId) return reply.code(400).send({ error: { message: "缺少 voice（Fish 音色 ID）", type: "invalid_request_error" } });

  const requestedFormat = String(body.response_format || "mp3").toLowerCase();
  const format = ["mp3", "wav", "opus", "pcm"].includes(requestedFormat) ? requestedFormat : "mp3";
  const speed = Number(body.speed);
  const fishBody = {
    text,
    reference_id: referenceId,
    format,
    normalize: true,
    chunk_length: 300,
    latency: "normal"
  };
  if (Number.isFinite(speed) && speed >= 0.5 && speed <= 2) {
    fishBody.prosody = { speed, volume: 0, normalize_loudness: true };
  }

  try {
    const upstream = await fetch(FISH_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fishKey}`,
        "Content-Type": "application/json",
        model
      },
      body: JSON.stringify(fishBody)
    });

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 1000);
      req.log.warn({ status: upstream.status, detail }, "Fish Audio TTS failed");
      return reply.code(upstream.status).send({
        error: { message: `Fish Audio 请求失败：${detail || `HTTP ${upstream.status}`}`, type: "upstream_error" }
      });
    }

    const audio = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get("content-type") || (format === "wav" ? "audio/wav" : format === "opus" ? "audio/ogg" : "audio/mpeg");
    return reply.code(200).header("Content-Type", contentType).header("Content-Length", String(audio.length)).send(audio);
  } catch (error) {
    req.log.error(error, "Fish Audio request exception");
    return reply.code(502).send({ error: { message: `无法连接 Fish Audio：${error.message}`, type: "upstream_connection_error" } });
  }
});

app.listen({ port: PORT, host: "0.0.0.0" })
  .then(address => app.log.info(`Fish Audio 语音桥运行在 ${address}`))
  .catch(error => { app.log.error(error); process.exit(1); });
