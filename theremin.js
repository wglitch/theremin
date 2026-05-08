// =================================================================
// HELA DIN THEREMIN.JS - BÖRJA OM MED DENNA KOD
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
    // Starta ljudkontexten
    initAudio();

    // === DEN HÄR DELEN ÄR DEN VIKTIGA FIXEN ===
    // Dölj startknappen
    startButton.style.display = 'none';
    // Visa canvas och kontroller
    canvasContainer.style.display = 'block';
    controls.style.display = 'block';
    // ==========================================

    // Starta kameran
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
    // Rensa canvasen
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Rita kamerabilden
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    const detectedHands = [false, false]; // [Hand 1, Hand 2]

    // Om händer hittas...
    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, i) => {
            const handIndex = results.multiHandedness[i].label === 'Left' ? 0 : 1;
            if (handIndex < 2) {
                detectedHands[handIndex] = true;
                const handColor = handIndex === 0 ? '#00FF00' : '#FF0000'; // Grön för vänster, röd för höger

                // Rita händer
                drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: handColor, lineWidth: 5 });
                drawLandmarks(canvasCtx, landmarks, { color: handColor, lineWidth: 2 });
                
                // Hämta pekfingertoppens position
                const fingerTip = landmarks[8];
                const x = fingerTip.x;
                const y = 1 - fingerTip.y; // Invertera Y-axeln så att högre upp = högre värde

                // Uppdatera ljud
                const freq = 100 + x * 800; // Frekvens baserat på X
                const vol = y * 0.5;        // Volym baserat på Y
                oscillators[handIndex].frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.01);
                gains[handIndex].gain.setTargetAtTime(vol, audioCtx.currentTime, 0.01);

                // Uppdatera UI (matchar din HTML)
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
