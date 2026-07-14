## Usage

### Quick Start (Recommended)
\`\`\`javascript
import DoubaoVoiceObserver from 'doubao-voice-observer';

const controller = DoubaoVoiceObserver.listen(
    document.querySelector('input'),
    (text) => {
        console.log('Voice input:', text);
    }
);

// Clean up
controller.destroy();
\`\`\`

### Advanced (Standard Event API)
\`\`\`javascript
const observer = new DoubaoVoiceObserver(input);
input.addEventListener(DoubaoVoiceObserver.EVENT_COMPLETE, handler);
observer.destroy();
\`\`\`