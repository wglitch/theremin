const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const startButton = document.getElementById('startButton');
const canvasContainer = document.getElementById('canvasContainer');
const controls = document.getElementById('controls');

const masterVolumeSlider = document.getElementById('masterVolume');
const leftDriveSlider = document.getElementById('leftDrive');
const rightDriveSlider = document.getElementById('rightDrive');
const leftReverbSlider = document.getElementById('leftReverb');
const rightReverbSlider = document.getElementById('rightReverb');

const leftPitchDisplay = document.getElementById('leftPitchDisplay');
const rightPitchDisplay = document.getElementById('rightPitchDisplay');
const leftVolumeDisplay = document.getElementById('leftVolumeDisplay');
const rightVolumeDisplay = document.getElementById('rightVolumeDisplay');

videoElement.style.transform = 'scaleX(-1)';

const VOICE_SETTINGS = {
    Left: {
        name: 'Oo',
        color: '#d8b35a',
        minHz: 65,
        maxHz: 660,
        pan: -0.36,
        formants: [360, 760],
        pitchDisplay: leftPitchDisplay,
        volumeDisplay: leftVolumeDisplay,
        driveSlider: leftDriveSlider,
        reverbSlider: leftReverbSlider,
    },
    Right: {
        name: 'Aa',
        color: '#f06a2f',
        minHz: 82,
        maxHz: 1046,
        pan: 0.36,
        formants: [780, 1220],
        pitchDisplay: rightPitchDisplay,
        volumeDisplay: rightVolumeDisplay,
        driveSlider: rightDriveSlider,
        reverbSlider: rightReverbSlider,
    },
};

const PITCH_CURVE = 1.45;
const DEFAULT_NEAR_HAND_SIZE = 0.9;
const DEFAULT_FAR_HAND_SIZE = 0.2;
const STATE_DECAY = 0.12;

let audioCtx;
let masterGain;
let compressor;
let reverbNode;
let camera;
const voices = {};

const handStates = {
    Left: createHandState(),
    Right: createHandState(),
};

const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.55,
});
hands.onResults(onResults);

function createHandState() {
    return {
        nearSize: DEFAULT_NEAR_HAND_SIZE,
        farSize: DEFAULT_FAR_HAND_SIZE,
        pitchControl: 0,
        volumeControl: 0,
        frequency: 0,
        volume: 0,
        x: 0.5,
        y: 0.5,
        active: false,
        age: 0,
    };
}

async function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = Number(masterVolumeSlider.value);

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 20;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.16;

    reverbNode = audioCtx.createConvolver();
    reverbNode.buffer = createImpulseResponse(audioCtx, 1.9, 1.9);

    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);
    reverbNode.connect(masterGain);

    voices.Left = createVoice('Left');
    voices.Right = createVoice('Right');

    await unlockAudio();
}

async function unlockAudio() {
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    const buffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(masterGain);
    source.start(0);
}

function createVoice(side) {
    const settings = VOICE_SETTINGS[side];
    const now = audioCtx.currentTime;

    const oscillator = audioCtx.createOscillator();
    oscillator.type = side === 'Left' ? 'triangle' : 'sawtooth';
    oscillator.frequency.setValueAtTime(settings.minHz, now);

    const input = audioCtx.createGain();
    input.gain.value = 0.7;

    const formantA = createFormantFilter(settings.formants[0], side === 'Left' ? 7 : 8);
    const formantB = createFormantFilter(settings.formants[1], side === 'Left' ? 9 : 10);
    const formantAGain = audioCtx.createGain();
    const formantBGain = audioCtx.createGain();
    const bodyGain = audioCtx.createGain();
    const bodyFilter = audioCtx.createBiquadFilter();
    const blend = audioCtx.createGain();
    const shaper = audioCtx.createWaveShaper();
    const output = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner();
    const reverbSend = audioCtx.createGain();

    formantAGain.gain.value = side === 'Left' ? 0.68 : 0.56;
    formantBGain.gain.value = side === 'Left' ? 0.32 : 0.46;
    bodyGain.gain.value = side === 'Left' ? 0.24 : 0.18;
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.value = side === 'Left' ? 980 : 1500;
    bodyFilter.Q.value = 0.7;

    output.gain.value = 0;
    panner.pan.value = settings.pan;
    reverbSend.gain.value = Number(settings.reverbSlider.value) * 0.38;
    shaper.curve = makeDistortionCurve(Number(settings.driveSlider.value));
    shaper.oversample = '4x';

    oscillator.connect(input);
    input.connect(formantA);
    input.connect(formantB);
    input.connect(bodyFilter);
    formantA.connect(formantAGain);
    formantB.connect(formantBGain);
    bodyFilter.connect(bodyGain);
    formantAGain.connect(blend);
    formantBGain.connect(blend);
    bodyGain.connect(blend);
    blend.connect(shaper);
    shaper.connect(output);
    output.connect(panner);
    panner.connect(masterGain);
    output.connect(reverbSend);
    reverbSend.connect(reverbNode);

    oscillator.start();

    return {
        oscillator,
        output,
        panner,
        shaper,
        reverbSend,
        driveSlider: settings.driveSlider,
        reverbSlider: settings.reverbSlider,
    };
}

function createFormantFilter(frequency, q) {
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    return filter;
}

async function startTheremin() {
    startButton.disabled = true;
    startButton.textContent = 'Starting...';

    try {
        if (!audioCtx) {
            await initAudio();
        } else {
            await unlockAudio();
        }

        startButton.style.display = 'none';
        canvasContainer.classList.add('is-live');
        controls.classList.add('is-live');

        if (!camera) {
            camera = new Camera(videoElement, {
                onFrame: async () => {
                    await hands.send({ image: videoElement });
                },
                width: 1280,
                height: 720,
                facingMode: 'user',
            });
            await camera.start();
        }
    } catch (error) {
        startButton.disabled = false;
        startButton.textContent = 'Start instrument';
        drawStandby(`Audio or camera did not start: ${error.message || 'permission blocked'}`);
    }
}

function onResults(results) {
    resizeCanvas();

    handStates.Left.active = false;
    handStates.Right.active = false;

    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, i) => {
            const side = results.multiHandedness[i].label;
            if (!handStates[side]) return;

            updateHandState(side, landmarks);
        });
    }

    updateAudio();
    drawScope();
}

function updateHandState(side, landmarks) {
    const state = handStates[side];
    const handSize = getHandSize(landmarks);
    const center = getHandCenter(landmarks);
    const openness = getHandOpenness(landmarks);

    updateDistanceCalibration(state, handSize);

    const pitchControl = handSizeToPitchControl(state, handSize);
    state.pitchControl = lerp(state.pitchControl, pitchControl, 0.22);
    state.volumeControl = lerp(state.volumeControl, openness, 0.3);
    state.frequency = pitchControlToFrequency(side, state.pitchControl);
    state.volume = state.volumeControl;
    state.x = lerp(state.x, center.x, 0.24);
    state.y = lerp(state.y, center.y, 0.24);
    state.active = true;
    state.age = 0;
}

function updateAudio() {
    if (!audioCtx || !voices.Left || !voices.Right) return;

    const now = audioCtx.currentTime;
    masterGain.gain.setTargetAtTime(Number(masterVolumeSlider.value), now, 0.035);

    updateVoice('Left', now);
    updateVoice('Right', now);
}

function updateVoice(side, now) {
    const voice = voices[side];
    const state = handStates[side];
    const settings = VOICE_SETTINGS[side];

    if (!state.active) {
        state.volumeControl = lerp(state.volumeControl, 0, STATE_DECAY);
        state.volume = state.volumeControl;
        state.age += 1;
    }

    const volume = state.active || state.age < 10 ? state.volume * 0.42 : 0;
    voice.oscillator.frequency.setTargetAtTime(state.frequency || settings.minHz, now, 0.055);
    voice.output.gain.setTargetAtTime(volume, now, 0.045);
    voice.panner.pan.setTargetAtTime(settings.pan, now, 0.08);
    voice.reverbSend.gain.setTargetAtTime(Number(settings.reverbSlider.value) * 0.42, now, 0.08);
    voice.shaper.curve = makeDistortionCurve(Number(settings.driveSlider.value));

    settings.pitchDisplay.textContent = `${Math.round(state.frequency || settings.minHz)} Hz`;
    settings.volumeDisplay.textContent = `${Math.round(state.volume * 100)}%`;
}

function resizeCanvas() {
    const rect = canvasElement.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.round(rect.width * pixelRatio));
    const height = Math.max(240, Math.round(rect.height * pixelRatio));

    if (canvasElement.width !== width || canvasElement.height !== height) {
        canvasElement.width = width;
        canvasElement.height = height;
    }
}

function drawStandby(message = 'Press start and place the phone flat. Move both hands above the camera.') {
    resizeCanvas();
    drawScopeBackground();

    const { width, height } = canvasElement;
    canvasCtx.save();
    canvasCtx.fillStyle = '#d8c7a0';
    canvasCtx.font = `${Math.max(14, width * 0.022)}px Courier New, monospace`;
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText(message, width / 2, height * 0.55);
    canvasCtx.restore();
}

function drawScope() {
    drawScopeBackground();
    drawVoice('Left');
    drawVoice('Right');
    drawWaveform();
    drawScanner();
}

function drawScopeBackground() {
    const { width, height } = canvasElement;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.38;

    canvasCtx.clearRect(0, 0, width, height);
    canvasCtx.fillStyle = '#12100c';
    canvasCtx.fillRect(0, 0, width, height);

    canvasCtx.save();
    canvasCtx.strokeStyle = 'rgba(216, 199, 160, 0.13)';
    canvasCtx.lineWidth = Math.max(1, width * 0.0015);

    for (let i = 1; i <= 5; i += 1) {
        canvasCtx.beginPath();
        canvasCtx.arc(cx, cy, (radius / 5) * i, 0, Math.PI * 2);
        canvasCtx.stroke();
    }

    for (let i = 0; i < 12; i += 1) {
        const angle = (Math.PI * 2 * i) / 12;
        canvasCtx.beginPath();
        canvasCtx.moveTo(cx + Math.cos(angle) * radius * 0.18, cy + Math.sin(angle) * radius * 0.18);
        canvasCtx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
        canvasCtx.stroke();
    }

    canvasCtx.strokeStyle = 'rgba(240, 106, 47, 0.22)';
    canvasCtx.strokeRect(width * 0.045, height * 0.075, width * 0.91, height * 0.85);
    canvasCtx.restore();
}

function drawVoice(side) {
    const state = handStates[side];
    const settings = VOICE_SETTINGS[side];
    const { width, height } = canvasElement;
    const displayX = side === 'Left' ? width * (0.18 + state.pitchControl * 0.27) : width * (0.55 + state.pitchControl * 0.27);
    const displayY = height * (0.77 - state.volumeControl * 0.48);
    const level = clamp(state.volumeControl, 0.03, 1);
    const glow = state.active ? 0.9 : 0.28;

    canvasCtx.save();
    canvasCtx.globalAlpha = glow;
    canvasCtx.strokeStyle = settings.color;
    canvasCtx.fillStyle = settings.color;
    canvasCtx.lineWidth = Math.max(2, width * 0.0035);

    canvasCtx.beginPath();
    canvasCtx.arc(displayX, displayY, Math.max(12, width * 0.025 + level * width * 0.018), 0, Math.PI * 2);
    canvasCtx.stroke();

    canvasCtx.beginPath();
    canvasCtx.moveTo(displayX - width * 0.035, displayY);
    canvasCtx.lineTo(displayX + width * 0.035, displayY);
    canvasCtx.moveTo(displayX, displayY - height * 0.055);
    canvasCtx.lineTo(displayX, displayY + height * 0.055);
    canvasCtx.stroke();

    canvasCtx.font = `${Math.max(12, width * 0.018)}px Courier New, monospace`;
    canvasCtx.textAlign = 'center';
    canvasCtx.fillText(`${settings.name} ${Math.round(state.frequency || settings.minHz)} Hz`, displayX, displayY - height * 0.085);
    canvasCtx.restore();
}

function drawWaveform() {
    const { width, height } = canvasElement;
    const midY = height * 0.5;
    const left = handStates.Left;
    const right = handStates.Right;
    const amp = height * 0.045 + (left.volumeControl + right.volumeControl) * height * 0.055;
    const cycles = 5 + (left.pitchControl + right.pitchControl) * 10;

    canvasCtx.save();
    canvasCtx.strokeStyle = 'rgba(216, 179, 90, 0.82)';
    canvasCtx.lineWidth = Math.max(2, width * 0.003);
    canvasCtx.beginPath();

    for (let i = 0; i <= 220; i += 1) {
        const x = width * 0.18 + (width * 0.64 * i) / 220;
        const t = i / 220;
        const y = midY + Math.sin(t * Math.PI * 2 * cycles) * amp * Math.sin(t * Math.PI);
        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
    }

    canvasCtx.stroke();
    canvasCtx.restore();
}

function drawScanner() {
    const { width, height } = canvasElement;
    const time = performance.now() * 0.00045;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.38;
    const angle = time % (Math.PI * 2);

    canvasCtx.save();
    canvasCtx.strokeStyle = 'rgba(240, 106, 47, 0.42)';
    canvasCtx.lineWidth = Math.max(1, width * 0.002);
    canvasCtx.beginPath();
    canvasCtx.moveTo(cx, cy);
    canvasCtx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    canvasCtx.stroke();
    canvasCtx.restore();
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

function getHandCenter(landmarks) {
    const sum = landmarks.reduce((acc, point) => {
        acc.x += point.x;
        acc.y += point.y;
        return acc;
    }, { x: 0, y: 0 });

    return {
        x: sum.x / landmarks.length,
        y: sum.y / landmarks.length,
    };
}

function updateDistanceCalibration(state, handSize) {
    if (handSize > state.nearSize) {
        state.nearSize = lerp(state.nearSize, handSize, 0.35);
    } else {
        state.nearSize = lerp(state.nearSize, Math.max(handSize, DEFAULT_NEAR_HAND_SIZE), 0.002);
    }

    if (handSize < state.farSize) {
        state.farSize = lerp(state.farSize, handSize, 0.35);
    } else {
        state.farSize = lerp(state.farSize, Math.min(handSize, DEFAULT_FAR_HAND_SIZE), 0.002);
    }

    if (state.nearSize - state.farSize < 0.18) {
        const center = (state.nearSize + state.farSize) / 2;
        state.nearSize = center + 0.09;
        state.farSize = center - 0.09;
    }
}

function handSizeToPitchControl(state, handSize) {
    const raw = (state.nearSize - handSize) / (state.nearSize - state.farSize);
    return clamp(raw, 0, 1);
}

function pitchControlToFrequency(side, control) {
    const settings = VOICE_SETTINGS[side];
    const curved = Math.pow(clamp(control, 0, 1), PITCH_CURVE);
    return settings.minHz * Math.pow(settings.maxHz / settings.minHz, curved);
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

function createImpulseResponse(context, seconds, decay) {
    const length = Math.floor(context.sampleRate * seconds);
    const impulse = context.createBuffer(2, length, context.sampleRate);

    for (let channel = 0; channel < 2; channel += 1) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < length; i += 1) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
        }
    }

    return impulse;
}

function makeDistortionCurve(amount) {
    const samples = 256;
    const curve = new Float32Array(samples);
    const drive = 1 + amount * 34;

    for (let i = 0; i < samples; i += 1) {
        const x = (i * 2) / samples - 1;
        curve[i] = Math.tanh(x * drive);
    }

    return curve;
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

startButton.addEventListener('click', startTheremin);
window.addEventListener('resize', () => {
    drawStandby();
});
drawStandby();
