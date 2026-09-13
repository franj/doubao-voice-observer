// ========== 豆包 iOS 语音输入严密特征检测器 (带逻辑归零 + 多轮二次优化) ==========
const FSM = {
    IDLE: 'IDLE',
    DELETING: 'DELETING',
    WAIT_ZERO: 'WAIT_ZERO',
    INJECTING: 'INJECTING',
    VERIFYING: 'VERIFYING'
};

/**
 * 默认验证窗口策略：按文本长度动态计算
 * 观察值：~21 字约 300-400ms 开始二次修正；~120 字约 1.0-1.1s
 * 拟合：t ≈ 200 + 7*len；加安全余量 → 250 + 9*len
 * 下限 500ms（短文本兜底），上限 4000ms（长文本封顶）
 */
function defaultVerifyWindow(text) {
    const len = text ? text.length : 0;
    const t = 250 + 9 * len;
    return Math.max(500, Math.min(4000, t));
}

class DoubaoVoiceObserver {
    static get EVENT_COMPLETE() {
        return 'doubao:voice:complete';
    }

    constructor(element, options = {}) {
        this.element = element;

        // 兼容之前直接传 debug 布尔值的初始化方式
        if (typeof options === 'boolean') {
            options = { debug: options };
        }

        this.debug = options.debug || false;

        // 允许忽略的残余首字符参数
        const prefixStr = options.ignorePrefixChars !== undefined ? options.ignorePrefixChars : "。. ";
        this.ignorePrefixChars = Array.from(prefixStr);

        // 退格触发时的 gap 区间匹配（默认 0 禁用）
        const gapCfg = options.keyupDeleteGap || {};
        this.keyupDeleteGapMin = gapCfg.min || 0;
        this.keyupDeleteGapMax = gapCfg.max || 0;
        this.keyupDeleteGapMaxLen = gapCfg.maxTextLength || 0;
        this.lastKeyupTime = 0;

        // 验证窗口策略：数字（固定 ms）或函数 (text) => ms
        this.verifyWindow = options.verifyWindow || defaultVerifyWindow;

        // 状态机
        this.state = FSM.IDLE;
        this.expectedText = "";
        this.verifyText = "";
        this.timer = null;

        // 唯一的跨轮记忆：候选资格
        // 语义：完整走到 VERIFYING，并在验证窗口内被豆包自身的退格打断
        this.candidate = false;

        this._handleEvent = this._handleEvent.bind(this);
        this.init();
    }

    init() {
        const events = ['keydown', 'keyup', 'beforeinput', 'input', 'blur', 'focus'];
        events.forEach(ev => this.element.addEventListener(ev, this._handleEvent));
        document.addEventListener('selectionchange', this._handleEvent);
    }

    destroy() {
        const events = ['keydown', 'keyup', 'beforeinput', 'input', 'blur', 'focus'];
        events.forEach(ev => this.element.removeEventListener(ev, this._handleEvent));
        document.removeEventListener('selectionchange', this._handleEvent);
        this._reset();
    }

    _log(msg, ...args) {
        if (this.debug) console.log(`[DoubaoFSM | ${this.state}] ${msg}`, ...args);
    }

    _reset() {
        this.state = FSM.IDLE;
        this.expectedText = "";
        this.verifyText = "";
        this.candidate = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    _isControlKey(key) {
        return ['Backspace', 'Enter', 'Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(key);
    }

    /**
     * 判断输入框是否“逻辑归零”
     * 严格限定：只有在彻底为空，或只剩下 1 个被允许忽略的字符时，才视为归零。
     */
    _isLogicalZero(text) {
        if (text.length === 0) return true;
        if (text.length === 1 && this.ignorePrefixChars.includes(text)) return true;
        return false;
    }

    /**
     * 归一化文本：处理换行，如果首字符是残余标点，一并静默剥离
     */
    _normalizeText(text) {
        let processed = text;
        if (processed.length > 0 && this.ignorePrefixChars.includes(processed[0])) {
            processed = processed.substring(1);
        }
        return processed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    }

    _dispatch(reason, text) {
        this._log(`🎯 Successfully triggered! Reason: ${reason}`);
        this.element.dispatchEvent(new CustomEvent(DoubaoVoiceObserver.EVENT_COMPLETE, {
            bubbles: true,
            detail: { text, reason }
        }));
        this._reset();
    }

    /**
     * 计算当前文本对应的验证窗口时长（ms）
     */
    _computeVerifyDelay(text) {
        if (typeof this.verifyWindow === 'function') {
            return this.verifyWindow(text);
        }
        if (typeof this.verifyWindow === 'number' && this.verifyWindow > 0) {
            return this.verifyWindow;
        }
        return defaultVerifyWindow(text);
    }

    _enterVerifying(text, reason) {
        this.state = FSM.VERIFYING;
        this.verifyText = text;
        const delay = this._computeVerifyDelay(text);
        this._log(`✅ Injection verified: Starting silent countdown ${delay}ms (reason: ${reason}, len: ${text.length})`);
        this.timer = setTimeout(() => {
            this._dispatch(reason, this.verifyText);
        }, delay);
    }

    _handleEvent(e) {
        // ===== 记录最近一次单字符输入的 keyup =====
        if (e.type === 'keyup' && this.state === FSM.IDLE && !this._isControlKey(e.key) && e.key.length === 1) {
            this.lastKeyupTime = Date.now();
            this._log(`Recorded single-char keyup "${e.key}" at ${this.lastKeyupTime}`);
        }

        // ===== blur / focus =====
        if (e.type === 'blur') {
            const text = this._normalizeText(this.element.value);
            if (text.length > 0) {
                this._dispatch('blur_fallback', text);
            } else {
                this._reset();
            }
            return;
        }

        if (e.type === 'focus') {
            this._reset();
            return;
        }

        // ===== 状态机 =====
        switch (this.state) {
            case FSM.IDLE:
                // 只有在输入框非逻辑为空时，退格才算作删除流程的开始
                if (e.type === 'keydown' && e.key === 'Backspace' && !this._isLogicalZero(this.element.value)) {
                    const currentText = this.element.value;
                    // 条件 C：若设置了 maxTextLength 且内容长度已超限，则跳过忽略逻辑
                    const skipFilterByLen = this.keyupDeleteGapMaxLen > 0 && currentText.length > this.keyupDeleteGapMaxLen;
                    if (!skipFilterByLen) {
                        const now = Date.now();
                        const gap = now - this.lastKeyupTime;
                        if (this.keyupDeleteGapMin > 0 && this.keyupDeleteGapMax > 0 && this.lastKeyupTime > 0
                            && gap >= this.keyupDeleteGapMin && gap <= this.keyupDeleteGapMax) {
                            this._log(`⏳ Backspace ignored: A∩B∩C passed (len=${currentText.length}≤${this.keyupDeleteGapMaxLen || '∞'}, gap=${gap}ms ∈ [${this.keyupDeleteGapMin},${this.keyupDeleteGapMax}])`);
                            break;  // 不进入删除状态
                        }
                    }
                    this.state = FSM.DELETING;
                    this.expectedText = "";
                    this._log("Feature matching started: Entering continuous backspace");
                }
                break;

            case FSM.DELETING:
                if (['beforeinput', 'input'].includes(e.type) && e.inputType === 'deleteContentBackward') {
                    // 正在删除，保持状态
                } else if (e.type === 'selectionchange') {
                    // 忽略
                } else if (e.type === 'keyup' && e.key === 'Backspace') {
                    this.state = FSM.WAIT_ZERO;
                    this._log("Backspace keyup: Waiting for logical zero");
                } else {
                    this._reset();
                }
                break;

            case FSM.WAIT_ZERO:
                if (e.type === 'selectionchange' && this._isLogicalZero(this.element.value)) {
                    this.state = FSM.INJECTING;
                    this._log("✅ Logical zero verified: Waiting for long text injection");
                } else if (e.type === 'keydown' && e.key.length > 1 && !this._isControlKey(e.key) && this._isLogicalZero(this.element.value)) {
                    this.expectedText = e.key;
                    this.state = FSM.INJECTING;
                    this._log(`Long text Key received: length ${e.key.length}`);
                } else {
                    this._reset();
                }
                break;

            case FSM.INJECTING:
                if (e.type === 'keydown' && e.key.length > 1 && !this._isControlKey(e.key)) {
                    this.expectedText = e.key;
                } else if (['beforeinput', 'input'].includes(e.type) && ['insertText', 'insertParagraph'].includes(e.inputType)) {
                    // 注入中，保持状态
                } else if (e.type === 'selectionchange') {
                    // 忽略
                } else if (e.type === 'keyup') {
                    const normCurrent = this._normalizeText(this.element.value);

                    if (this.candidate) {
                        // 有候选：不要求严格相等，只要当前文本非空即可接受
                        if (normCurrent.length > 0 && e.key.length > 1 && !this._isControlKey(e.key)) {
                            this.candidate = false; // 消费候选
                            this._enterVerifying(normCurrent, 'fsm_match_revision');
                        } else {
                            this._log("❌ Revision acceptance failed: empty or invalid keyup");
                            this._reset();
                        }
                    } else {
                        // 无候选：严格匹配
                        const normExpected = this._normalizeText(this.expectedText);
                        if (e.key === this.expectedText && normExpected === normCurrent) {
                            this._enterVerifying(normCurrent, 'fsm_match');
                        } else {
                            this._log("❌ Injection verification failed: Text mismatch");
                            this._reset();
                        }
                    }
                } else {
                    this._reset();
                }
                break;

            case FSM.VERIFYING:
                // 静默验证窗口内
                if (e.type === 'keydown' && e.key === 'Backspace' && !this._isLogicalZero(this.element.value)) {
                    // 豆包自身的二次修正：保留候选，直接接下一轮
                    if (this.timer) {
                        clearTimeout(this.timer);
                        this.timer = null;
                    }
                    this.candidate = true;
                    this.state = FSM.DELETING;
                    this.expectedText = "";
                    this._log("🔁 Doubao revision detected: candidate = true, entering DELETING");
                } else if (e.type === 'keydown' && e.key.length === 1 && !this._isControlKey(e.key)) {
                    // 用户手动输入：彻底清零（含 candidate）
                    this._log("❌ Manual intervention during VERIFYING: reset all");
                    this._reset();
                }
                // 其他事件忽略，计时器继续
                break;
        }
    }

    static listen(element, onComplete, options = {}) {
        const instance = new DoubaoVoiceObserver(element, options);

        const handler = (e) => {
            onComplete(e.detail.text, e.detail.reason);
        };
        element.addEventListener(DoubaoVoiceObserver.EVENT_COMPLETE, handler);

        return {
            destroy: () => {
                element.removeEventListener(DoubaoVoiceObserver.EVENT_COMPLETE, handler);
                instance.destroy();
            },
            instance
        };
    }
}

// Support CommonJS & ES Module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DoubaoVoiceObserver;
} else {
    window.DoubaoVoiceObserver = DoubaoVoiceObserver;
}