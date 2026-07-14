// ========== 豆包 iOS 语音输入高精确特征检测器 ==========
class DoubaoVoiceObserver {
    // 将事件名导出为静态常量，方便用户引用，避免硬编码拼错
    static get EVENT_COMPLETE() {
        return 'doubao:voice:complete';
    }

    constructor(element, options = {}) {
        this.element = element;
        this.options = Object.assign({
            minFinalizeLength: 2,
            onComplete: null,
        }, options);

        this.state = 'IDLE';
        this.baselineLength = 0;
        this.deleteCount = 0;
        this.insertedText = '';

        this._handlers = {
            keydown: this._handleKeyDown.bind(this),
            input: this._handleInput.bind(this),
            keyup: this._handleKeyUp.bind(this),
            selectionchange: this._handleSelectionChange.bind(this)
        };
        // 🆕 如果用户传了 onComplete，自动帮他把事件挂上
        if (this.options.onComplete) {
            // 注意这里绑定了 this，方便销毁时移除
            this._completeHandler = (e) => {
                this.options.onComplete(e.detail.text, e);
            };
            this.element.addEventListener(
                DoubaoVoiceObserver.EVENT_COMPLETE,
                this._completeHandler
            );
        }
        this.init();
    }

    init() {
        this.element.addEventListener('keydown', this._handlers.keydown);
        this.element.addEventListener('input', this._handlers.input);
        this.element.addEventListener('keyup', this._handlers.keyup);
        document.addEventListener('selectionchange', this._handlers.selectionchange);
    }

    _reset() {
        this.state = 'IDLE';
        this.baselineLength = 0;
        this.deleteCount = 0;
        this.insertedText = '';
    }

    _handleKeyDown(e) {
        if (e.key === 'Backspace') {
            this.state = 'DELETING';
            this.baselineLength = this.element.value.length;
            this.deleteCount = 0;
        } else if (this.state === 'ZERO_WAIT' && e.key && e.key.length > 1) {
            this.state = 'INSERTING';
            this.insertedText = e.key;
        } else {
            this._reset();
        }
    }

    _handleInput(e) {
        if (this.state === 'DELETING' && e.inputType === 'deleteContentBackward') {
            this.deleteCount++;
        }
    }

    _handleKeyUp(e) {
        if (e.key === 'Backspace') {
            if (this.state === 'DELETING') {
                const isMatched = (this.deleteCount === this.baselineLength);
                const isOverMin = (this.baselineLength >= this.options.minFinalizeLength);

                if (isMatched && isOverMin) {
                    this.state = 'ZERO_WAIT';
                } else {
                    this._reset();
                }
            }
        } else if (this.state === 'INSERTING' && e.key === this.insertedText) {
            const normValue = this.element.value.replace(/\r\n/g, '\n');
            const normInserted = this.insertedText.replace(/\r\n/g, '\n');

            if (normValue === normInserted) {
                this._dispatchComplete(this.insertedText);
            }
            this._reset();
        }
    }

    _handleSelectionChange() {
        if (document.activeElement !== this.element) return;
        if (this.state === 'ZERO_WAIT' && this.element.value.length === 0) {
            // 静默等待重写 KeyDown 触发
        }
    }

    _dispatchComplete(finalText) {
        const event = new CustomEvent(DoubaoVoiceObserver.EVENT_COMPLETE, {
            bubbles: true,
            cancelable: true,
            detail: {
                text: finalText
            }
        });
        this.element.dispatchEvent(event);
    }

    destroy() {
        this.element.removeEventListener('keydown', this._handlers.keydown);
        this.element.removeEventListener('input', this._handlers.input);
        this.element.removeEventListener('keyup', this._handlers.keyup);
        document.removeEventListener('selectionchange', this._handlers.selectionchange);
        if (this._completeHandler) {
            this.element.removeEventListener(
                DoubaoVoiceObserver.EVENT_COMPLETE,
                this._completeHandler
            );
        }
    }
    static listen(element, onComplete, options = {}) {
        // 1. 创建实例（注意不要把 onComplete 传给构造函数，避免重复绑定）
        const instance = new DoubaoVoiceObserver(element, {
            ...options,
            onComplete: null // 强制清空，防止构造函数再绑一次
        });

        // 2. 我们自己管理事件监听
        const handler = (e) => {
            onComplete(e.detail.text, e);
        };
        element.addEventListener(DoubaoVoiceObserver.EVENT_COMPLETE, handler);

        // 3. 返回一个“超级控制器”
        return {
            // 用户只需调用 destroy，即可清理所有资源
            destroy: () => {
                element.removeEventListener(DoubaoVoiceObserver.EVENT_COMPLETE, handler);
                instance.destroy();
            },
            // 如果用户需要访问原始实例做高级操作（比如动态改配置），也暴露出来
            instance: instance
        };
    }
}

// 支持 CommonJS 和 ES Module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DoubaoVoiceObserver;
}