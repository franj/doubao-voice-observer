# Doubao Voice Observer

> 专为豆包（Doubao）iOS 语音输入法设计的 Web 端高准确率完成事件检测器。

## 🧠 背景与动机

在 iOS 的 WebView（包括 Safari 和 WKWebView）中，**中文输入法（包括语音输入）不会触发 `compositionstart` / `compositionend` 事件**。这意味着常规的 `input` 事件监听无法准确区分用户是正在通过拼音输入法拼写、还是已经完成了语音输入的文字确认。

**豆包输入法**在 iOS 上的语音输入流程具有独特的键盘事件序列特征。本库通过精确匹配 `keydown` / `input` / `keyup` 事件的数量和顺序，反向推导出语音输入“确认完成”的时刻，并派发自定义事件 `doubao:voice:complete`(DoubaoVoiceObserver.EVENT_COMPLETE)。

> **⚠️ 重要提示**：本实现基于当前（2026年7月）豆包输入法在 iOS 上的行为特征反向工程得出。经过大量测试，准确率较高，但由于豆包输入法随时可能更新其内部事件流程，**如果发现不适用，可能是豆包版本更新改变了行为，请及时提交 Issue 或考虑升级本库。**

## 📦 安装

```bash
npm install doubao-voice-observer
```

## 🚀 使用

### 快速开始（推荐）

```javascript
import DoubaoVoiceObserver from 'doubao-voice-observer';

const controller = DoubaoVoiceObserver.listen(
    document.querySelector('input'),
    (text) => {
        console.log('Voice input detected:', text);
        // 在这里处理语音识别完成的文本
    }
);

// 组件卸载时清理
controller.destroy();
```

### 高级用法（标准事件 API）

如果你需要更灵活的控制（如添加多个监听器、在父容器上捕获事件等），可以直接使用类实例：

```javascript
const observer = new DoubaoVoiceObserver(input);
input.addEventListener(DoubaoVoiceObserver.EVENT_COMPLETE, (e) => {
    console.log('Voice input:', e.detail.text);
});

// 清理时记得销毁观察器（仅移除内部监听，用户外部监听需自行管理）
observer.destroy();
```

### 配置项

```javascript
new DoubaoVoiceObserver(input, {
    minFinalizeLength: 2, // 最小判定基准长度，默认 2
    onComplete: (text) => { /* 回调 */ }
});
```

## 🔧 工作原理简述

1. 当语音输入结束时，豆包会**先删除之前临时插入的文本**（退格若干次）。
2. 然后**一次性插入最终确定的完整文本**。
3. 本库通过精确匹配：
   - 退格次数 === 退格前文本长度
   - 退格前长度 ≥ `minFinalizeLength`
   - 最终插入的文本与键盘事件的 `key` 值一致
   
   来确定语音输入已完成。

## 📌 注意事项

- 本库**仅适用于 iOS 设备上的豆包输入法**，其他输入法或平台未经测试。
- 如果语音输入后文本未被自动发送或检测失败，请尝试调整 `minFinalizeLength` 参数（一般默认 2 即可）。
- 豆包输入法更新后，检测算法可能需要同步升级，欢迎提交 PR。

## 📄 License

MIT
