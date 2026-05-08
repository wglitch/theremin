// =================================================================
// HELA DIN THEREMIN.JS - KORREKT VERSION
// =================================================================

// 1. Hämta alla HTML-element vi behöver
const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const startButton = document.getElementById('startButton');
const canvasContainer = document.getElementById('canvasContainer');
const controls = document.getElementById('controls');

// 2. Ljud-setup (Globala variabler)
let audioCtx;
const oscillators = [null, null];
const gains = [null, null];

// Funktion för att initiera ljudet (måste göras efter en användarinteraktion)
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        for (let i = 0; i < 2; i++) {
            oscillators[i] = audioCtx.createOscillator();
            gains[i] = audioCtx.createGain();
            gains[i].gain.setValueAtTime(0, audioCtx.currentTime); // Starta tyst
            oscillators[i].connect(gains[i]);
            gains[i].connect(audioCtx.destination);
            oscillators[i].start();
        }
    }
}

// 3. Funktion för att starta allt (kameran och UI)
function startTheremin() {
    initAudio();
    console.log('Theremin startad!');

    // Dölj startknappen
    startButton.style.display = 'none';
    // Visa canvas och kontroller
    canvasContainer.style.display = 'block';
    controls.style.display = 'block';

    const camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({ image: videoElement });
        },
        width: 1280,
        height: 720
    });
    camera.start();
}

// Lyssna på klick på startknappen
startButton.addEventListener('click', startTheremin);


// 4. MediaPipe Hands-inställningar
const hands = new Hands({
    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

// Koppla onResults-funktionen till hands-objektet
hands.onResults(onResults);


// 5. Huvudfunktionen som körs för varje bildruta från kameran
function onResults(results) {
    // --- Konstanter för finjustering ---
    // Låg ton när handen är på detta avstånd (närmare 0 = närmare skärmen)
    const NEAR_Z = -0.05; 
    // Hög ton när handen är på detta avstånd (mer negativt = längre bort)
    const FAR_Z = -0.9;
    // ------------------------------------

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    const detectedHands = [false, false];

    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, i) => {
            const handIndex = results.multiHandedness[i].label === 'Left' ? 0 : 1;
            if (handIndex < 2) {
                detectedHands[handIndex] = true;
                const handColor = handIndex === 0 ? '#00FF00' : '#FF0000';

                drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: handColor, lineWidth: 5 });
                drawLandmarks(canvasCtx, landmarks, { color: handColor, lineWidth: 2 });
                
                const fingerTip = landmarks[8]; // Pekfingertoppen
                
                // === KORREKT LOGIK FÖR TONHÖJD ===
                // 1. Normalisera Z-värdet: Omvandla avståndet till ett värde mellan 0.0 och 1.0
                // Detta garanterar att NÄRA ger ett värde nära 0, och LÅNGT BORT ger ett värde nära 1.
                const normalizedZ = (fingerTip.z - NEAR_Z) / (FAR_Z - NEAR_Z);
                const pitchControl = Math.max(0, Math.min(1, normalizedZ));
                
                // 2. Mappa tonhöjden till det normaliserade värdet
                const freq = 40 + pitchControl * 960; // 40Hz (låg) till 1000Hz (hög)

                // 3. Radiell volym (högst i mitten)
                const distanceFromCenter = Math.sqrt(Math.pow(fingerTip.x - 0.5, 2) + Math.pow(fingerTip.y - 0.5, 2));
                const vol = Math.max(0, 1 - (distanceFromCenter / 0.707));

                // Uppdatera ljudet
                oscillators[handIndex].frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.01);
                gains[handIndex].gain.setTargetAtTime(vol, audioCtx.currentTime, 0.01);

                // Uppdatera UI
                const freqLabel = document.getElementById(`freq${handIndex + 1}`);
                const volLabel = document.getElementById(`vol${handIndex + 1}`);
                if (freqLabel) freqLabel.textContent = `${Math.round(freq)} Hz`;
                if (volLabel) volLabel.textContent = `${Math.round(vol * 100)}%`;
            }
        });
    }

    // Stäng av ljudet för händer som inte längre syns
    detectedHands.forEach((isDetected, index) => {
        if (!isDetected && gains[index]) {
            gains[index].gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
        }
    });

    canvasCtx.restore();
}