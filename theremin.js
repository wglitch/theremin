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
    for (let i = 0; i < 2; i++) {
        oscillators[i] = audioCtx.createOscillator();
        gains[i] = audioCtx.createGain();
        gains[i].gain.setValueAtTime(0, audioCtx.currentTime);
        oscillators[i].connect(gains[i]);
        gains[i].connect(audioCtx.destination);
        oscillators[i].start();
    }
}

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
}

function onResults(results) {
    const NEAR_Z = -0.05;
    const FAR_Z = -0.9;

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
                
                const fingerTip = landmarks[8];
                const zValue = fingerTip.z;
                
                let pitchControl = (zValue - NEAR_Z) / (FAR_Z - NEAR_Z);
                pitchControl = Math.max(0, Math.min(1, pitchControl));
                
                const freq = 40 + pitchControl * 960;
                const distanceFromCenter = Math.sqrt(Math.pow(fingerTip.x - 0.5, 2) + Math.pow(fingerTip.y - 0.5, 2));
                const vol = Math.max(0, 1 - (distanceFromCenter / 0.707));

                oscillators[handIndex].frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.01);
                gains[handIndex].gain.setTargetAtTime(vol, audioCtx.currentTime, 0.01);

                document.getElementById(`freq${handIndex + 1}`).textContent = `${Math.round(freq)} Hz`;
                document.getElementById(`vol${handIndex + 1}`).textContent = `${Math.round(vol * 100)}%`;

                debugZ.textContent = zValue.toFixed(3);
                debugPitch.textContent = pitchControl.toFixed(3);
            }
        });
    }

    detectedHands.forEach((isDetected, index) => {
        if (!isDetected && gains[index]) {
            gains[index].gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
        }
    });

    canvasCtx.restore();
}

// --- Starta applikationen ---
startButton.addEventListener('click', startTheremin);