# 从零开始：给 Kelivo 接入自己的 Fish 语音

> 这是一人一站的个人部署步骤。所有 Key 都只填在你自己的账号里，不要发给任何人。

---

## 第一步：先注册 Fish Audio

1. 打开：<https://fish.audio/auth/signup>
2. 注册并登录。
3. 打开 API Key 页面：<https://fish.audio/app/api-keys/>
4. 点 **Create New Key**，复制并保存 API Key。
5. 在 Fish Audio 里选一个你有权使用的音色，复制它的 **Reference ID**。

你现在要保存两样东西：

```text
Fish API Key
音色 Reference ID
```

---

## 第二步：复制语音桥代码

1. 打开：<https://github.com/1906777392-star/dylan-heartbeat/fork>
2. 点 **Create fork**。
3. 不用改代码，等它复制完成。

---

## 第三步：部署到 Railway

1. 打开：<https://railway.app/new>
2. 登录 Railway；第一次会要求连接 GitHub，同意即可。
3. 点 **Deploy from GitHub repo**。
4. 选择刚刚 Fork 的 `dylan-heartbeat`。
5. 等待服务创建完成。

---

## 第四步：Railway 填 3 项

进入 Railway 的服务 → **Variables** → 逐个新增：

| 名称 | 填什么 |
|---|---|
| `FISH_API_KEY` | 第一步复制的 Fish API Key |
| `TTS_GATEWAY_KEY` | 自己随便设一串很长的密码 |
| `FISH_MODEL` | `s2.1-pro-free` |

填完后等待 Railway 显示：

```text
Deployment successful
```

---

## 第五步：复制自己的服务器地址

Railway 服务 → **Settings** → **Networking** → 生成 / 复制公网域名。

它长这样：

```text
https://你的服务-production-xxxx.up.railway.app
```

在浏览器打开：

```text
你的服务器地址/health
```

看到下面这行就成功：

```json
{"ok":true,"service":"fish-audio-openai-bridge"}
```

---

## 第六步：回 Kelivo 填写

Kelivo → **设置** → **语音服务** → 新增 → 提供方选择 **OpenAI**。

| 要填的项目 | 填什么 |
|---|---|
| 名称 | 随便写，例如：我的 Fish 语音 |
| API 基址 | `你的服务器地址/v1` |
| API Key | Railway 里的 `TTS_GATEWAY_KEY` |
| 模型 | `s2.1-pro-free` |
| 音色 | 第一步保存的 Fish Audio Reference ID |

### 示例

```text
API 基址：https://abc-production-xxxx.up.railway.app/v1
API Key：自己设置的 TTS_GATEWAY_KEY
模型：s2.1-pro-free
音色：自己的 Fish Audio Reference ID
```

---

## 只记住这两个别填错

```text
Fish API Key → 只填 Railway 的 FISH_API_KEY
TTS_GATEWAY_KEY → 只填 Kelivo 的 API Key
```

---

## 如果报错

- **404**：API 基址最后漏了 `/v1`
- **Key 无效**：Kelivo 填错了 Key；它只能填 `TTS_GATEWAY_KEY`
- **生成失败**：检查 Fish API Key、音色 Reference ID 是否正确

---

> 说明：第三方平台的账号、额度、价格和规则由平台决定，可能调整。请自行保管密钥并遵守 Fish Audio、Railway、Kelivo 的规则。
> 
> 本仓库当前许可证限制商业使用；本指南不授予任何付费销售、付费代部署或商业服务权利。
