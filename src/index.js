// ========== 1.1 豆包 iOS 语音输入严密特征检测器 (带逻辑归零机制) ==========
const FSM = {
    IDLE: 'IDLE',
    DELETING: 'DELETING',
    WAIT_ZERO: 'WAIT_ZERO',
    INJECTING: 'INJECTING',
    SILENT_VERIFYING: 'SILENT_VERIFYING'
};

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
        
        // 【新增】允许忽略的残余首字符参数。直接传入字符串即可。
        // 默认包含中文句号、英文点号、空格。转为数组以便精确匹配。
        const prefixStr = options.ignorePrefixChars !== undefined ? options.ignorePrefixChars : "。. ";
        this.ignorePrefixChars = Array.from(prefixStr);

        this.state = FSM.IDLE;
        this.expectedText = "";
        this.timer = null;

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
        if (this.state !== FSM.IDLE) {
            this.state = FSM.IDLE;
            this.expectedText = "";
            if (this.timer) {
                clearTimeout(this.timer);
                this.timer = null;
            }
        }
    }

    _isControlKey(key) {
        return ['Backspace', 'Enter', 'Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(key);
    }

    /**
     * 【核心新增】判断输入框是否“逻辑归零”
     * 严格限定：只有在彻底为空，或只剩下 1 个被允许忽略的字符时，才视为归零。
     */
    _isLogicalZero(text) {
        if (text.length === 0) return true;
        if (text.length === 1 && this.ignorePrefixChars.includes(text)) return true;
        return false;
    }

    /**
     * 【修改】归一化文本：除了处理换行，如果首字符是残余标点，一并静默剥离
     */
    _normalizeText(text) {
        let processed = text;
        if (processed.length > 0 && this.ignorePrefixChars.includes(processed[0])) {
            processed = processed.substring(1); // 剥离最前面的 1 个字符
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

    _handleEvent(e) {
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

        if (this.state === FSM.SILENT_VERIFYING) {
            if (['keydown', 'input', 'beforeinput'].includes(e.type)) {
                this._log(`❌ Verification interrupted: Manual intervention within 500ms (${e.type})`);
                this._reset();
            }
            return; 
        }

        switch (this.state) {
            case FSM.IDLE:
                // 【修改】只有在输入框非逻辑为空时，退格才算作删除流程的开始
                if (e.type === 'keydown' && e.key === 'Backspace' && !this._isLogicalZero(this.element.value)) {
                    this.state = FSM.DELETING;
                    this._log("Feature matching started: Entering continuous backspace");
                }
                break;

            case FSM.DELETING:
                if (['beforeinput', 'input'].includes(e.type) && e.inputType === 'deleteContentBackward') {
                } else if (e.type === 'selectionchange') {
                } else if (e.type === 'keyup' && e.key === 'Backspace') {
                    this.state = FSM.WAIT_ZERO;
                    this._log("Backspace keyup: Waiting for logical zero");
                } else {
                    this._reset();
                }
                break;

            case FSM.WAIT_ZERO:
                // 【修改】使用 _isLogicalZero 替代 length === 0
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
                } else if (e.type === 'selectionchange') {
                } else if (e.type === 'keyup') {
                    // 预期的 key 和实际 value 都走一遍 _normalizeText，抹平那 1 个残留标点带来的差异
                    const normExpected = this._normalizeText(this.expectedText);
                    const normCurrent = this._normalizeText(this.element.value);
                    
                    if (e.key === this.expectedText && normExpected === normCurrent) {
                        this.state = FSM.SILENT_VERIFYING;
                        this._log("✅ Injection verified: Starting 500ms silent countdown");
                        
                        this.timer = setTimeout(() => {
                            // 抛出被规范化后的干净文本
                            this._dispatch('fsm_match', normCurrent);
                        }, 500);
                    } else {
                        this._log("❌ Injection verification failed: Text mismatch");
                        this._reset();
                    }
                } else {
                    this._reset();
                }
                break;
        }
    }

    // static listen 的参数也同步放宽，以支持传递配置对象
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