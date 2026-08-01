# Kelivo × Fish Audio 私人语音桥（速查版）

> 仅供个人自行部署和使用。
> 不要公开 API Key；不要把自己的地址和 Key 给陌生人。

## 你要准备的 3 个东西

1. Fish Audio 的 API Key
2. Fish Audio 音色的 Reference ID
3. 自己设定的一串随机密码

---

## Railway 只填 3 个 Variables

打开 Railway 项目 → **Variables** → 逐个添加：

| 名称 | 填什么 |
|---|---|
| `FISH_API_KEY` | Fish Audio 后台的 API Key |
| `TTS_GATEWAY_KEY` | 自己设一串随机长密码 |
| `FISH_MODEL` | `s2.1-pro-free` |

保存后，等 Railway 显示 **Deployment successful**。

---

## 找自己的服务器地址

Railway 服务页面顶部的公网域名，形如：

```text
https://你的服务-production-xxxx.up.railway.app
```

打开下面这个地址：

```text
https://你的服务-production-xxxx.up.railway.app/health
```

如果显示：

```json
{"ok":true,"service":"fish-audio-openai-bridge"}
```

说明服务正常。

---

## Kelivo 怎么填

Kelivo → **设置** → **语音服务** → 新增 → 提供方选 **OpenAI**。

| Kelivo 项目 | 填写内容 |
|---|---|
| 名称 | 随意，例如“我的 Fish 语音” |
| API 基址 | `https://你的Railway域名/v1` |
| API Key | Railway 的 `TTS_GATEWAY_KEY` |
| 模型 | `s2.1-pro-free` |
| 音色 | Fish Audio 的 Reference ID |

### 最容易填错的地方

- API 基址最后必须有：`/v1`
- Kelivo 的 API Key 填：`TTS_GATEWAY_KEY`
- `FISH_API_KEY` **只放在 Railway Variables，不填进 Kelivo**
- 音色填 Fish Audio 的 **Reference ID**，不是音色名称

---

## 报错时先看这里

| 情况 | 先检查 |
|---|---|
| API Key 无效 | Kelivo 是否误填了 `FISH_API_KEY` |
| 404 | API 基址是否漏了 `/v1` |
| 服务打不开 | Railway 是否显示 Active / Deployment successful |
| 能连接但生成失败 | Fish API Key、模型、音色 Reference ID 是否正确 |

---

## 我的填写示例（不要照抄域名和 Key）

```text
API 基址：https://my-fish-tts-production-xxxx.up.railway.app/v1
API Key：我自己设置的 TTS_GATEWAY_KEY
模型：s2.1-pro-free
音色：我自己的 Fish Audio Reference ID
```
