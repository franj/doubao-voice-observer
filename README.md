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
    debug: true,              // 开启 debug 日志
    ignorePrefixChars: "。. " // 自定义忽略的残余首字符（可选，默认 "。. "）
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

## 🔧 核心原理：严格特征流水线 (FSM)

本库摒弃了不稳定的定时器盲猜机制，而是验证输入法是否严格走完了以下完整的单向状态流：

1. **IDLE**：空闲态，等待触发。
2. **DELETING**：识别到连续退格（Backspace）。仅在输入框非"逻辑归零"状态时，退格才算作删除流程的开始。
3. **WAIT_ZERO**：退格完毕后，通过 `selectionchange` 强制校验输入框当前内容是否"逻辑归零"（彻底为空，或仅剩 1 个可忽略的残余字符）。
4. **INJECTING**：捕获到非常规的长文本机器级 `keydown` 事件（`e.key.length > 1`），且随后混合派发了一系列合法的 `insertText` / `insertParagraph` 事件。
5. **SILENT_VERIFYING**：写入完成（`keyup`）时进行双重文本比对（预期文本 vs 实际值，均经过 `_normalizeText` 归一化）。比对通过后，进入长达 **500ms** 的静默安全倒计时。期间任何人类介入行为（如继续按键输入）都会瞬间熔断并重置状态机。倒计时结束即确认定稿，派发 `fsm_match` 事件。
6. **兜底机制**：只要用户点击收起键盘或点击其他区域触发了 `blur` 失去焦点，且输入框有内容，强制触发完成事件（`blur_fallback`）。

## 📌 注意事项

- 本库专用于解决 iOS 设备上使用第三方智能输入法（如豆包）时的自动发送兼容性痛点。
- 请勿在此库之上再额外叠加外部 debounce 防抖，这可能导致最终输出延迟过高（本库内部已妥善处理 500ms 的静默判定）。
- `ignorePrefixChars` 默认包含中文句号、英文点号和空格。如果你的业务场景中这些字符是有效输入，请通过配置项调整或置空。

## 📄 License

MIT
