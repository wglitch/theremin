// --- Hämta alla HTML-element FÖRST ---
const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const startButton = document.getElementById('startButton');
const canvasContainer = document.getElementById('canvasContainer');
const controls = document.getElementById('controls');
const masterVolumeSlider = document.getElementById('masterVolume');

// --- Ljudvariabler ---
let audioCtx;
const oscillator = [null]; // Vi behöver bara en
const gain = [null];       // Vi behöver bara en

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
    oscillator[0] = audioCtx.createOscillator();
    gain[0] = audioCtx.createGain();
    gain[0].gain.setValueAtTime(0, audioCtx.currentTime);
    oscillator[0].connect(gain[0]);
    gain[0].connect(audioCtx.destination);
    oscillator[0].start();
}

function startTheremin() {
    initAudio();
    startButton.style.display = 'none';
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

function onResults(results) {
    const pitchDisplay = document.getElementById('pitchDisplay');
    const volumeDisplay = document.getElementById('volumeDisplay');

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    let finalFreq = 82;
    let finalVol = 0;

    const NEAR_Z = -0.5;
    const FAR_Z = 0.1;
    const baseFreq = 82;
    const range = 441;

    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, i) => {
            const handedness = results.multiHandedness[i].label;
            const fingerTip = landmarks[8];

            if (handedness === 'Right') {
                const handColor = '#FF0000'; // Röd
                drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: handColor, lineWidth: 5 });
                drawLandmarks(canvasCtx, landmarks, { color: handColor, lineWidth: 2 });

                let pitchControl = (fingerTip.z - NEAR_Z) / (FAR_Z - NEAR_Z);
                pitchControl = Math.max(0, Math.min(1, pitchControl));
                finalFreq = baseFreq + pitchControl * range;
            }

            if (handedness === 'Left') {
                const handColor = '#00FF00'; // Grön
                drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: handColor, lineWidth: 5 });
                drawLandmarks(canvasCtx, landmarks, { color: handColor, lineWidth: 2 });

                const volControl = (fingerTip.x - 0.1) / (0.9 - 0.1);
                const handVol = Math.max(0, Math.min(1, volControl));
                const masterVol = parseFloat(masterVolumeSlider.value);
                finalVol = handVol * masterVol;
            }
        });
    }

    if (audioCtx) {
        oscillator[0].frequency.setTargetAtTime(finalFreq, audioCtx.currentTime, 0.08);
        gain[0].gain.setTargetAtTime(finalVol, audioCtx.currentTime, 0.08);
    }
    
    pitchDisplay.textContent = `${Math.round(finalFreq)} Hz`;
    volumeDisplay.textContent = `${Math.round(finalVol * 100)}%`;

    canvasCtx.restore();
}

// --- Starta applikationen ---
startButton.addEventListener('click', startTheremin);