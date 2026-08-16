# Doubao Voice Observer

> 专为豆包（Doubao）iOS 语音输入法设计的 Web 端高准确率完成事件检测器，基于有限状态机（FSM）构建，实现 0 误判检测。

## 🧠 背景与动机

在 iOS 的 WebView（包括 Safari 和 WKWebView）中，**中文输入法（包括智能语音输入）不会触发 `compositionstart` / `compositionend` 事件**。这意味着常规的 Web 事件监听无法准确区分用户是正在正常敲击键盘打字，还是使用第三方输入法完成了大段语音输入的自动纠错定稿。

通过底层逆向分析，我们发现**豆包输入法**在 iOS 上的智能语音定稿具备极其独特的机器行为签名。本库通过构建严格的**有限状态机（FSM）**，捕获这套"彻底清空 ➔ 长文本瞬间注入 ➔ 彻底静默"的时序特征，安全可靠地反向推导出语音输入"确认完成"的准确时刻，并派发自定义事件 `doubao:voice:complete`。

> **⚠️ 重要提示**：本实现基于豆包输入法在 iOS 上的底层行为特征反向工程得出。采用极为严苛的序列匹配，**不会对正常的键盘打字产生任何误判拦截**。但如果未来豆包输入法更新了其底层注入逻辑，本算法可能失效。欢迎随时提交 Issue 探讨更新。

## 📦 安装

```bash
npm install doubao-voice-observer
```

## 🚀 使用

### 快速开始（推荐）

本库提供了一个 `listen` 静态工厂方法，一行代码即可接入：

```javascript
import DoubaoVoiceObserver from 'doubao-voice-observer';

const observer = DoubaoVoiceObserver.listen(
    document.querySelector('textarea'),
    (text, reason) => {
        console.log('Voice input completed!');
        console.log('Final Text:', text);
        console.log('Triggered by:', reason); // 'fsm_match' 或 'blur_fallback'

        // 在此处执行您的自动发送逻辑...
    },
    { debug: false } // 设为 true 可在控制台打印 FSM 状态流转日志
);

// 当组件卸载或不再需要时，务必调用销毁以清理内存
observer.destroy();
```

> **向后兼容**：第三个参数也支持直接传 `false` / `true` 布尔值来控制 debug 日志，与旧版本用法完全兼容。

### 标准用法（标准事件 API）

如果你需要更灵活的事件流控制（如事件冒泡捕获、在 React/Vue 中管理实例），可以直接实例化该类：

```javascript
const inputEl = document.getElementById('chat-input');

const observer = new DoubaoVoiceObserver(inputEl, {
    debug: true,                  // 开启 debug 日志
    ignorePrefixChars: "。. ",     // 自定义忽略的残余首字符（可选，默认 "。. "）
    keyupDeleteGap: { min: 400, max: 600 } // 退格触发的特征区间（可选，默认 0 禁用）
});

inputEl.addEventListener(DoubaoVoiceObserver.EVENT_COMPLETE, (e) => {
    const { text, reason } = e.detail;
    console.log(`Received text via ${reason}:`, text);
});

// 清理观察器
observer.destroy();
```

### ⚙️ 配置项

构造函数和 `listen()` 方法均支持以下配置项（传入 `options` 对象）：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `debug` | `boolean` | `false` | 是否在控制台打印 FSM 状态流转日志 |
| `ignorePrefixChars` | `string` | `"。. "` | 逻辑归零时允许忽略的残余首字符集合。包含中文句号、英文点号、空格 |
| `keyupDeleteGap` | `{ min: number, max: number }` | `{ min: 0, max: 0 }` | 当退格（Backspace）事件发生时，若距离最近一次**单字符** `keyup` 的时间差恰好落在 `[min, max]` 毫秒区间内，则判定为豆包语音输入的**内部中间修正**，忽略该退格（不进入 `DELETING` 状态）。`min` / `max` 任一为 `0` 时禁用此检查。<br>此参数基于豆包输入法的实测行为特征设计：<br>• **内部修正（特征区间内）**：豆包在语音识别过程中进行「清空重写」时，距离上一次逐字上屏通常约为 **400～600ms**。只有 gap 恰好落入此窗口才视为内部修正并忽略。<br>• **最终定稿（区间外）**：当语音结束后执行最终的「清空 → 长文本注入」时，gap 通常要么极短（<400ms，发生在连续操作末端）要么较长（>600ms，用户停顿后）。二者均不落在特征区间，故会正常进入检测流程并触发完成事件。<br>推荐配置：`{ min: 400, max: 600 }`，可根据实际表现微调。 |

#### 关于 `ignorePrefixChars`（逻辑归零机制）

豆包输入法在执行"清空 ➔ 重写"操作时，有时不会将输入框彻底清空到 0 字符，而是可能残留 1 个标点符号（如句号 `。`）。如果不处理这种情况，FSM 会在 `WAIT_ZERO` 阶段判定清空失败而放弃匹配。

**逻辑归零机制**通过 `_isLogicalZero()` 方法解决此问题：当输入框为空，或仅剩 1 个属于 `ignorePrefixChars` 的字符时，即视为"逻辑归零"，允许 FSM 继续推进。同时，`_normalizeText()` 会在最终派发文本时静默剥离这些残余首字符，确保输出干净。

如需自定义忽略的字符，传入字符串即可：

```javascript
// 例如：只忽略中文句号
new DoubaoVoiceObserver(el, { ignorePrefixChars: "。" });

// 或传入空字符串来禁用此机制，恢复严格归零
new DoubaoVoiceObserver(el, { ignorePrefixChars: "" });
```

#### 关于 `keyupDeleteGap`（语音内部修正的特征区间过滤器）

该参数基于对豆包语音输入过程的**实测行为特征**提炼，用于精准识别「中间修正」型的清空重写，避免其被误判为「最终定稿」的开始。

**核心思路**：不使用「越小越像修正」的单调阈值，而是匹配一个**特征时间窗口**。经过实际观察，豆包在语音输入过程中进行内部修正时，「上一次逐字上屏」与「开始退格删除」之间的间隔稳定落在 **400～600ms** 左右；而真正的「最终定稿」清空操作，其 gap 通常要么极短（连续操作末端，<400ms），要么较长（用户停顿或语音结束后，>600ms），恰好不落在特征区间内。

典型流程对照：

```
【中间修正 → 被忽略】
逐字上屏 (keyup, e.key.length===1) → 约 520ms → 退格 (gap ∈ [400,600])
                                              ↑ 命中特征区间，忽略退格，保持 IDLE

【最终定稿 → 正常检测】
逐字上屏 → 约 850ms → 退格 (gap > 600)
                    ↑ 超出区间上限，正常进入 DELETING → WAIT_ZERO → ... → complete
【或】
逐字上屏 → 约 280ms → 退格 (gap < 400)
                    ↑ 低于区间下限，同样正常进入检测流程
```

**基准时间的可靠性**：用于计算 gap 的「最近一次 keyup 时间」只在 **IDLE 状态且 e.key 为单字符** 时更新，确保基准是豆包逐字上屏的真实时刻，不会被长文本注入、控制键等事件污染。

配置示例：

```javascript
// 推荐：启用特征区间过滤，匹配豆包典型行为
new DoubaoVoiceObserver(el, { keyupDeleteGap: { min: 400, max: 600 } });

// min 或 max 任一为 0 即可禁用，恢复「所有退格都检测」的默认行为
new DoubaoVoiceObserver(el, { keyupDeleteGap: { min: 0, max: 0 } });
```

## 🔧 核心原理：严格特征流水线 (FSM)

本库摒弃了不稳定的定时器盲猜机制，而是验证输入法是否严格走完了以下完整的单向状态流：

1. **IDLE**：空闲态，等待触发。
2. **DELETING**：识别到连续退格（Backspace）。仅在输入框非"逻辑归零"状态，且（若配置了 `keyupDeleteGap`）距离最近一次**单字符** keyup 的 gap **不落在** `[min, max]` 特征区间内时，退格才算作删除流程的开始（落在特征区间的退格会被判定为内部中间修正而被忽略）。
3. **WAIT_ZERO**：退格完毕后，通过 `selectionchange` 强制校验输入框当前内容是否"逻辑归零"（彻底为空，或仅剩 1 个可忽略的残余字符）。
4. **INJECTING**：捕获到非常规的长文本机器级 `keydown` 事件（`e.key.length > 1`），且随后混合派发了一系列合法的 `insertText` / `insertParagraph` 事件。
5. **SILENT_VERIFYING**：写入完成（`keyup`）时进行双重文本比对（预期文本 vs 实际值，均经过 `_normalizeText` 归一化）。比对通过后，进入长达 **500ms** 的静默安全倒计时。期间任何新的事件（按键、输入等）都会瞬间熔断并重置状态机。倒计时结束即确认定稿，派发 `fsm_match` 事件。
6. **兜底机制**：只要用户点击收起键盘或点击其他区域触发了 `blur` 失去焦点，且输入框有内容，强制触发完成事件（`blur_fallback`）。

## 📌 注意事项

- 本库专用于解决 iOS 设备上使用第三方智能输入法（如豆包）时的自动发送兼容性痛点。
- 请勿在此库之上再额外叠加外部 debounce 防抖，这可能导致最终输出延迟过高（本库内部已妥善处理 500ms 的静默判定）。
- `ignorePrefixChars` 默认包含中文句号、英文点号和空格。如果你的业务场景中这些字符是有效输入，请通过配置项调整或置空。
- `keyupDeleteGap` 默认禁用（`min`/`max` 任一为 `0`）。推荐使用 `{ min: 400, max: 600 }` 作为起点，并根据实际豆包版本的行为特征微调。若观察到中间修正被漏判为定稿，可适当放宽区间；若定稿被误过滤，可适当收窄区间或临时禁用。

## 📄 License

MIT
