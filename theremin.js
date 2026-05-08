// --- Hamta alla HTML-element forst ---
const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const startButton = document.getElementById('startButton');
const canvasContainer = document.getElementById('canvasContainer');
const controls = document.getElementById('controls');
const masterVolumeSlider = document.getElementById('masterVolume');
const pitchDisplay = document.getElementById('pitchDisplay');
const volumeDisplay = document.getElementById('volumeDisplay');

// Mirror the video element so controls feel natural.
videoElement.style.transform = 'scaleX(-1)';

// --- Ljudvariabler ---
let audioCtx;
const oscillator = [null];
const gain = [null];

const PITCH_MIN_HZ = 82;
const PITCH_MAX_HZ = 880;
const PITCH_CURVE = 1.45;
const DEFAULT_NEAR_HAND_SIZE = 0.9;
const DEFAULT_FAR_HAND_SIZE = 0.2;

let observedNearHandSize = DEFAULT_NEAR_HAND_SIZE;
let observedFarHandSize = DEFAULT_FAR_HAND_SIZE;
let smoothedPitchControl = 0;
let smoothedVolumeControl = 0;

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
    if (!audioCtx) {
        initAudio();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

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
    if (videoElement.videoWidth && videoElement.videoHeight) {
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    canvasCtx.translate(canvasElement.width, 0);
    canvasCtx.scale(-1, 1);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    let finalFreq = pitchControlToFrequency(smoothedPitchControl);
    let finalVol = 0;
    let pitchHandFound = false;
    let volumeHandFound = false;
    const masterVol = parseFloat(masterVolumeSlider.value);

    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, i) => {
            const handedness = results.multiHandedness[i].label;

            if (handedness === 'Right') {
                drawHand(landmarks, '#FF0000');

                const handSize = getHandSize(landmarks);
                updateDistanceCalibration(handSize);
                const pitchControl = handSizeToPitchControl(handSize);
                smoothedPitchControl = lerp(smoothedPitchControl, pitchControl, 0.22);
                finalFreq = pitchControlToFrequency(smoothedPitchControl);
                pitchHandFound = true;
            }

            if (handedness === 'Left') {
                drawHand(landmarks, '#00FF00');

                const openControl = getHandOpenness(landmarks);
                smoothedVolumeControl = lerp(smoothedVolumeControl, openControl, 0.28);
                volumeHandFound = true;
            }
        });
    }

    if (!pitchHandFound) {
        finalFreq = pitchControlToFrequency(smoothedPitchControl);
    }
    if (volumeHandFound) {
        finalVol = smoothedVolumeControl * masterVol;
    } else {
        smoothedVolumeControl = lerp(smoothedVolumeControl, 0, 0.12);
        finalVol = smoothedVolumeControl * masterVol;
    }

    if (audioCtx) {
        oscillator[0].frequency.setTargetAtTime(finalFreq, audioCtx.currentTime, 0.08);
        gain[0].gain.setTargetAtTime(finalVol, audioCtx.currentTime, 0.06);
    }

    pitchDisplay.textContent = `${Math.round(finalFreq)} Hz`;
    volumeDisplay.textContent = `${Math.round(finalVol * 100)}%`;

    canvasCtx.restore();
}

function drawHand(landmarks, color) {
    drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color, lineWidth: 5 });
    drawLandmarks(canvasCtx, landmarks, { color, lineWidth: 2 });
}

function getHandSize(landmarks) {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;

    landmarks.forEach((point) => {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    });

    const width = maxX - minX;
    const height = maxY - minY;
    return Math.sqrt(width * width + height * height);
}

function updateDistanceCalibration(handSize) {
    // Adapt quickly to new extremes, but drift slowly so the instrument keeps its range.
    if (handSize > observedNearHandSize) {
        observedNearHandSize = lerp(observedNearHandSize, handSize, 0.35);
    } else {
        observedNearHandSize = lerp(observedNearHandSize, Math.max(handSize, DEFAULT_NEAR_HAND_SIZE), 0.002);
    }

    if (handSize < observedFarHandSize) {
        observedFarHandSize = lerp(observedFarHandSize, handSize, 0.35);
    } else {
        observedFarHandSize = lerp(observedFarHandSize, Math.min(handSize, DEFAULT_FAR_HAND_SIZE), 0.002);
    }

    if (observedNearHandSize - observedFarHandSize < 0.18) {
        const center = (observedNearHandSize + observedFarHandSize) / 2;
        observedNearHandSize = center + 0.09;
        observedFarHandSize = center - 0.09;
    }
}

function handSizeToPitchControl(handSize) {
    const raw = (observedNearHandSize - handSize) / (observedNearHandSize - observedFarHandSize);
    return clamp(raw, 0, 1);
}

function pitchControlToFrequency(control) {
    const curved = Math.pow(clamp(control, 0, 1), PITCH_CURVE);
    return PITCH_MIN_HZ * Math.pow(PITCH_MAX_HZ / PITCH_MIN_HZ, curved);
}

function getHandOpenness(landmarks) {
    const wrist = landmarks[0];
    const middleBase = landmarks[9];
    const palmSize = Math.max(distance(wrist, middleBase), 0.001);
    const fingertips = [4, 8, 12, 16, 20];
    const averageSpread = fingertips.reduce((sum, index) => {
        return sum + distance(landmarks[index], wrist);
    }, 0) / fingertips.length;

    return clamp((averageSpread / palmSize - 1.4) / 1.25, 0, 1);
}

function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

// --- Starta applikationen ---
startButton.addEventListener('click', startTheremin);
