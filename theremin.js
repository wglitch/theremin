// --- Hämta alla HTML-element FÖRST ---
const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const startButton = document.getElementById('startButton');
const canvasContainer = document.getElementById('canvasContainer');
const controls = document.getElementById('controls');
const debugInfo = document.getElementById('debugInfo');
const debugZ = document.getElementById('debugZ');
const debugPitch = document.getElementById('debugPitch');

// --- Ljudvariabler ---
let audioCtx;
const oscillators = [null, null];
const gains = [null, null];

// --- MediaPipe Hands-konfiguration ---
const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});
hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});
hands.onResults(onResults);

// --- Huvudfunktioner ---

function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Vi behöver bara EN oscillator och EN gain-nod nu
    oscillators[0] = audioCtx.createOscillator();
    gains[0] = audioCtx.createGain();
    gains[0].gain.setValueAtTime(0, audioCtx.currentTime);
    oscillators[0].connect(gains[0]);
    gains[0].connect(audioCtx.destination);
    oscillators[0].start();
}
} // Slut på initAudio

function startTheremin() {
    initAudio();
    console.log('Theremin startad!');

    startButton.style.display = 'none';
    canvasContainer.style.display = 'block';
    controls.style.display = 'block';
    debugInfo.style.display = 'block';

    const camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({ image: videoElement });
        },
        width: 1280,
        height: 720
    });
    camera.start();
} // Slut på startTheremin

function onResults(results) {
    // Hämta UI-element
    const pitchDisplay = document.getElementById('pitchDisplay');
    const volumeDisplay = document.getElementById('volumeDisplay');

    // Nollställ canvas
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    // Standardvärden (tystnad)
    let finalFreq = 82; // Lägsta tonen
    let finalVol = 0;   // Ingen volym

    // Inställningar för tonhöjd och spann
    const NEAR_Z = -0.5;
    const FAR_Z = 0.1;
    const baseFreq = 82; 
    const range = 441;

    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, i) => {
            const handedness = results.multiHandedness[i].label; // 'Left' eller 'Right'
            const fingerTip = landmarks[8]; // Pekfingertoppen

            if (handedness === 'Right') { // HÖGER HAND STYR TONHÖJD
                const handColor = '#FF0000'; // Röd
                drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: handColor, lineWidth: 5 });
                drawLandmarks(canvasCtx, landmarks, { color: handColor, lineWidth: 2 });

                let pitchControl = (fingerTip.z - NEAR_Z) / (FAR_Z - NEAR_Z);
                pitchControl = Math.max(0, Math.min(1, pitchControl));
                finalFreq = baseFreq + pitchControl * range;
            }

            if (handedness === 'Left') { // VÄNSTER HAND STYR VOLYM
                const handColor = '#00FF00'; // Grön
                drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: handColor, lineWidth: 5 });
                drawLandmarks(canvasCtx, landmarks, { color: handColor, lineWidth: 2 });

                // X-axeln (0.1 till 0.9) styr volymen
                const volControl = (fingerTip.x - 0.1) / (0.9 - 0.1);
                const handVol = Math.max(0, Math.min(1, volControl));
                const masterVol = parseFloat(masterVolumeSlider.value);
                finalVol = handVol * masterVol;
            }
        });
    }

    // Applicera de slutgiltiga värdena på den ENDA oscillatorn
    if (audioCtx) {
        oscillators[0].frequency.setTargetAtTime(finalFreq, audioCtx.currentTime, 0.08);
        gains[0].gain.setTargetAtTime(finalVol, audioCtx.currentTime, 0.08);
    }
    
    // Uppdatera UI
    pitchDisplay.textContent = `${Math.round(finalFreq)} Hz`;
    volumeDisplay.textContent = `${Math.round(finalVol * 100)}%`;

    canvasCtx.restore();
}