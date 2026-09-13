# Doubao Voice Observer

> 专为豆包（Doubao）iOS 语音输入法设计的 Web 端高准确率完成事件检测器，基于有限状态机（FSM）构建，实现 0 误判检测，支持多轮 AI 二次优化。

## 🧠 背景与动机

在 iOS 的 WebView（包括 Safari 和 WKWebView）中，**中文输入法（包括智能语音输入）不会触发 `compositionstart` / `compositionend` 事件**。这意味着常规的 Web 事件监听无法准确区分用户是正在正常敲击键盘打字，还是使用第三方输入法完成了大段语音输入的自动纠错定稿。

通过底层逆向分析，我们发现**豆包输入法**在 iOS 上的智能语音定稿具备极其独特的机器行为签名。本库通过构建严格的**有限状态机（FSM）**，捕获这套"彻底清空 ➔ 长文本瞬间注入 ➔ 彻底静默"的时序特征，安全可靠地反向推导出语音输入"确认完成"的准确时刻，并派发自定义事件 `doubao:voice:complete`。

> **⚠️ 重要提示**：本实现基于豆包输入法在 iOS 上的底层行为特征反向工程得出。采用极为严苛的序列匹配，**不会对正常的键盘打字产生任何误判拦截**。但如果未来豆包输入法更新了其底层注入逻辑，本算法可能失效。欢迎随时提交 Issue 探讨更新。

### 🆕 关于多轮 AI 二次优化

实测发现，豆包在语音定稿后会**再次调用 AI 对文本进行润色**，通常表现为：

1. 第一次注入完整文本；
2. 短暂的静默（数百毫秒至 1 秒多，取决于文本长度）；
3. 再次「清空 → 注入」一段被 AI 优化过的**新文本**（与第一次不完全一致）。

本库引入 `candidate` 机制与**按文本长度自适应的验证窗口**，能够正确识别这一行为并接受最终优化后的文本，而不是把第二次修正误判为"用户手动干预"而丢弃。

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
        console.log('Triggered by:', reason); // 'fsm_match' | 'fsm_match_revision' | 'blur_fallback'

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
    debug: true,
    ignorePrefixChars: "。. ",
    keyupDeleteGap: { min: 500, max: 700, maxTextLength: 15 }
});

inputEl.addEventListener(DoubaoVoiceObserver.EVENT_COMPLETE, (e) => {
    const { text, reason } = e.detail;
    console.log(`Received text via ${reason}:`, text);
});

observer.destroy();
```

### ⚙️ 配置项

构造函数和 `listen()` 方法均支持以下配置项（传入 `options` 对象）：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `debug` | `boolean` | `false` | 是否在控制台打印 FSM 状态流转日志 |
| `ignorePrefixChars` | `string` | `"。. "` | 逻辑归零时允许忽略的残余首字符集合。包含中文句号、英文点号、空格 |
| `keyupDeleteGap` | `{ min, max, maxTextLength? }` | `{ min: 0, max: 0 }` | 退格事件内部修正过滤。详见下方专节。 |
| `verifyWindow` | `number \| (text) => number` | 按长度自适应 | 静默验证窗口时长（毫秒）。传数字则固定；传函数则按文本动态计算；不传则使用内置公式 `clamp(250 + 9 × len, 500, 4000)`。 |

#### 关于 `ignorePrefixChars`（逻辑归零机制）

豆包输入法在执行"清空 ➔ 重写"操作时，有时不会将输入框彻底清空到 0 字符，而是可能残留 1 个标点符号（如句号 `。`）。如果不处理这种情况，FSM 会在 `WAIT_ZERO` 阶段判定清空失败而放弃匹配。

**逻辑归零机制**通过 `_isLogicalZero()` 方法解决此问题：当输入框为空，或仅剩 1 个属于 `ignorePrefixChars` 的字符时，即视为"逻辑归零"，允许 FSM 继续推进。同时，`_normalizeText()` 会在最终派发文本时静默剥离这些残余首字符，确保输出干净。

```javascript
// 例如：只忽略中文句号
new DoubaoVoiceObserver(el, { ignorePrefixChars: "。" });

// 传入空字符串来禁用此机制，恢复严格归零
new DoubaoVoiceObserver(el, { ignorePrefixChars: "" });
```

#### 关于 `keyupDeleteGap`（语音内部修正的特征区间过滤器）

该参数基于对豆包语音输入过程的**实测行为特征**提炼，用于精准识别「中间修正」型的清空重写，避免其被误判为「最终定稿」的开始。

**决策机制**：退格发生时必须**同时满足以下三个条件**（A ∩ B ∩ C），才会被判定为「内部中间修正」并跳过（保持 IDLE）；任一条件不满足，都会正常进入删除检测流程。

```
退格发生 → 条件 A（基准时间来自单字符 keyup）
            ↓ 不满足 → 进入删除检测
          条件 C（当前文本长度 ≤ maxTextLength，若已设置）
            ↓ 不满足 → 进入删除检测（长文本不会是早期补全）
          条件 B（gap ∈ [min, max] 特征区间）
            ↓ 不满足 → 进入删除检测
            ↓ 满足 → ✅ 判定为内部修正，忽略退格
```

- **条件 A — 基准时间来自单字符 keyup**：用于计算 gap 的「最近一次 keyup 时间」只在 **IDLE 状态且 `e.key.length === 1`** 时更新，确保基准是豆包逐字上屏的真实时刻，不会被长文本注入、控制键等事件污染。

- **条件 B — gap 落在特征时间窗口 [min, max]**：不使用「越小越像修正」的单调阈值，而是匹配一个**特征时间窗口**。豆包在语音识别过程中进行内部修正时，「上一次逐字上屏」与「开始退格删除」之间的间隔稳定落在 **500～700ms** 左右；而真正的「最终定稿」清空操作，其 gap 通常要么极短（<500ms）要么较长（>700ms），恰好不落在特征区间内。

- **条件 C — 文本长度上限 `maxTextLength`（可选）**：豆包的中间补全绝大多数发生在**输入初期**。一旦输入框内容已经增长到一定长度，豆包几乎不会执行「全删重写」，此时发生的删除极大概率就是用户说完后的最终定稿。设置此值后，若退格时内容已超过上限，则**无条件跳过区间忽略逻辑**，直接进入检测。

```javascript
// 推荐：启用三条件合取过滤
new DoubaoVoiceObserver(el, { keyupDeleteGap: { min: 500, max: 700, maxTextLength: 15 } });

// 只启用 gap 区间，不加文本长度保护
new DoubaoVoiceObserver(el, { keyupDeleteGap: { min: 500, max: 700 } });

// min/max 任一为 0 即可整体禁用，恢复「所有退格都检测」
new DoubaoVoiceObserver(el, { keyupDeleteGap: { min: 0, max: 0 } });
```

#### 关于 `verifyWindow`（静默验证窗口）

豆包在最终定稿后，可能会在数百毫秒到 1 秒多之间再次进行 AI 二次优化，且**耗时与文本长度正相关**（实测：~21 字约 300–400ms；~120 字约 1.0–1.1s）。

原先固定 500ms 的窗口在长文本场景下不够用，因此本库默认采用内置公式：

```
delay = clamp(250 + 9 × len, 500, 4000)
```

| 文本长度 | 默认窗口 |
|---|---|
| 21 字 | 500ms（下限兜底） |
| 120 字 | ~1330ms |
| 400 字 | ~3850ms |
| >400 字 | 4000ms（上限封顶） |

窗口是**最大等待**，不是必须等满：豆包一动手（`VERIFYING` 中收到退格）就立即清计时器并接下一轮，不会白白等满。

你可以按真实日志再校准：

```javascript
// 固定值
new DoubaoVoiceObserver(el, { verifyWindow: 800 });

// 自定义函数
new DoubaoVoiceObserver(el, {
    verifyWindow: (text) => Math.max(600, Math.min(5000, 200 + 12 * text.length))
});
```

## 🔧 核心原理：严格特征流水线 (FSM)

本库摒弃了不稳定的定时器盲猜机制，而是验证输入法是否严格走完了以下完整的单向状态流：

1. **IDLE**：空闲态，等待触发。
2. **DELETING**：识别到连续退格（Backspace）。仅在输入框非"逻辑归零"，且（若配置了 `keyupDeleteGap`）gap **不落在** 特征区间内时，退格才算作删除流程的开始。
3. **WAIT_ZERO**：退格完毕后，通过 `selectionchange` 强制校验输入框当前内容是否"逻辑归零"。
4. **INJECTING**：捕获到非常规的长文本机器级 `keydown`（`e.key.length > 1`），且随后混合派发了一系列合法的 `insertText` / `insertParagraph`。
5. **VERIFYING**：写入完成（`keyup`）时进行文本比对：
   - 若 `candidate === false`：严格比较 `expectedText` 与实际值（均经 `_normalizeText` 归一化）；
   - 若 `candidate === true`：跳过严格比较，直接接受当前文本（用于接受 AI 二次优化后的新文本）。
   
   比对通过后进入静默倒计时，窗口时长由 `verifyWindow` 决定（默认按文本长度自适应）。
6. **`candidate` 机制**：若在 `VERIFYING` 窗口内被豆包自身的退格打断，则置 `candidate = true` 并直接迁回 `DELETING`，自然衔接下一轮修正流程。任何其他异常分支（用户手动输入、状态不符合等）都会走 `_reset()`，将 `candidate` 一并清零。

**兜底机制**：用户点击收起键盘或触发 `blur` 失去焦点，且输入框有内容时，强制触发完成事件（`blur_fallback`）。

### 事件 reason 取值

| reason | 含义 |
|---|---|
| `fsm_match` | 完整走完 FSM，且文本严格匹配 |
| `fsm_match_revision` | 完整走完 FSM，且处于 `candidate` 上下文（接受了 AI 二次优化后的新文本） |
| `blur_fallback` | 失焦兜底触发 |

## 📌 注意事项

- 本库专用于解决 iOS 设备上使用第三方智能输入法（如豆包）时的自动发送兼容性痛点。
- 请勿在此库之上再额外叠加外部 debounce 防抖，这可能导致最终输出延迟过高（本库内部已妥善处理静默判定）。
- `ignorePrefixChars` 默认包含中文句号、英文点号和空格。如果你的业务场景中这些字符是有效输入，请通过配置项调整或置空。
- `keyupDeleteGap` 默认禁用（`min`/`max` 任一为 `0`）。推荐使用 `{ min: 500, max: 700, maxTextLength: 15 }` 作为起点，并根据实际豆包版本的行为特征微调。
- `verifyWindow` 默认按文本长度自适应。若观察到长文本二次修正耗时仍超过窗口，可显式传入函数放宽上限。
- `candidate` 支持**多轮链式修正**：第二次成功后若又被退格打断，会再次置 `true`，直至某一轮验证窗口内不再被打断才 dispatch。不做轮数上限。

## 📄 License

MIT