/**
 * Doubao Voice Observer
 * High-precision iOS dictation detector specifically for Doubao (豆包) input method rewriting feature.
 * Based on strict Finite State Machine (FSM).
 */

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

    constructor(element, debug = false) {
        this.element = element;
        this.debug = debug;

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

    _normalizeText(text) {
        return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
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
        // ========== 1. Fallback & Global Interruptions ==========
        if (e.type === 'blur') {
            const text = this.element.value.trim();
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

        // ========== 2. Silent Verification Interruption ==========
        if (this.state === FSM.SILENT_VERIFYING) {
            if (['keydown', 'input', 'beforeinput'].includes(e.type)) {
                this._log(`❌ Verification interrupted: Manual intervention within 500ms (${e.type})`);
                this._reset();
            }
            return; 
        }

        // ========== 3. Core Strict One-Way FSM ==========
        switch (this.state) {
            case FSM.IDLE:
                // Start FSM: Must press Backspace when text exists
                if (e.type === 'keydown' && e.key === 'Backspace' && this.element.value.length > 0) {
                    this.state = FSM.DELETING;
                    this._log("Feature matching started: Entering continuous backspace");
                }
                break;

            case FSM.DELETING:
                if (['beforeinput', 'input'].includes(e.type) && e.inputType === 'deleteContentBackward') {
                    // Valid deletion, keep state
                } else if (e.type === 'selectionchange') {
                    // Ignore cursor jitter
                } else if (e.type === 'keyup' && e.key === 'Backspace') {
                    this.state = FSM.WAIT_ZERO;
                    this._log("Backspace keyup: Waiting for length to reach 0");
                } else {
                    this._reset(); // Interrupted by impurity event
                }
                break;

            case FSM.WAIT_ZERO:
                if (e.type === 'selectionchange' && this.element.value.length === 0) {
                    // Strict condition: Textbox MUST be completely cleared
                    this.state = FSM.INJECTING; 
                    this._log("✅ Zero length verified: Waiting for long text injection");
                } else if (e.type === 'keydown' && e.key.length > 1 && !this._isControlKey(e.key) && this.element.value.length === 0) {
                    // Fault tolerance: If selectionchange is skipped by OS, proceed if length is 0
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
                    // Valid insertion
                } else if (e.type === 'selectionchange') {
                    // Ignore cursor jitter
                } else if (e.type === 'keyup') {
                    const normExpected = this._normalizeText(this.expectedText);
                    const normCurrent = this._normalizeText(this.element.value);
                    
                    // Double check: keyup text, expected text, and actual input value must highly match
                    if (e.key === this.expectedText && normExpected === normCurrent) {
                        this.state = FSM.SILENT_VERIFYING;
                        this._log("✅ Injection verified: Starting 500ms silent countdown");
                        
                        this.timer = setTimeout(() => {
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

    /**
     * Factory method for easy usage
     */
    static listen(element, onComplete, debug = false) {
        const instance = new DoubaoVoiceObserver(element, debug);
        
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