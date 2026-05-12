const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const startButton = document.getElementById('startButton');
const canvasContainer = document.getElementById('canvasContainer');
const controls = document.getElementById('controls');
const instrumentShell = document.querySelector('.instrument-shell');
const operationNotes = document.getElementById('operationNotes');
const serviceNotesButton = document.getElementById('serviceNotesButton');
const serviceNotesModal = document.getElementById('serviceNotesModal');
const closeServiceNotes = document.getElementById('closeServiceNotes');

const MASTER_GAIN = 0.72;
const knobs = {
    leftEdge: document.getElementById('leftEdge'),
    leftSpace: document.getElementById('leftSpace'),
    rightEdge: document.getElementById('rightEdge'),
    rightSpace: document.getElementById('rightSpace'),
};

const leftPitchDisplay = document.getElementById('leftPitchDisplay');
const rightPitchDisplay = document.getElementById('rightPitchDisplay');
const leftMeter = document.getElementById('leftMeter');
const rightMeter = document.getElementById('rightMeter');

videoElement.style.transform = 'scaleX(-1)';

const VOICE_SETTINGS = {
    Left: {
        name: 'Oo',
        color: '#f2d15a',
        minHz: 65,
        maxHz: 660,
        pan: -0.36,
        formants: [360, 760],
        pitchDisplay: leftPitchDisplay,
        meter: leftMeter,
        edgeKnob: knobs.leftEdge,
        spaceKnob: knobs.leftSpace,
    },
    Right: {
        name: 'Aa',
        color: '#f06a2f',
        minHz: 82,
        maxHz: 880,
        pan: 0.36,
        formants: [620, 1080],
        pitchDisplay: rightPitchDisplay,
        meter: rightMeter,
        edgeKnob: knobs.rightEdge,
        spaceKnob: knobs.rightSpace,
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

function dockOperationNotes() {
    operationNotes.classList.add('is-docking');
    serviceNotesButton.classList.add('is-docking-target');

    window.setTimeout(() => {
        operationNotes.classList.add('is-collapsed');
        operationNotes.classList.remove('is-docking');
        serviceNotesButton.classList.remove('is-docking-target');
    }, 620);
}

async function initAudio() {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = MASTER_GAIN;

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
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(settings.minHz, now);

    const input = audioCtx.createGain();
    input.gain.value = 0.7;

    const formantA = createFormantFilter(settings.formants[0], side === 'Left' ? 7 : 4.8);
    const formantB = createFormantFilter(settings.formants[1], side === 'Left' ? 9 : 5.4);
    const formantAGain = audioCtx.createGain();
    const formantBGain = audioCtx.createGain();
    const bodyGain = audioCtx.createGain();
    const bodyFilter = audioCtx.createBiquadFilter();
    const blend = audioCtx.createGain();
    const shaper = audioCtx.createWaveShaper();
    const output = audioCtx.createGain();
    const panner = audioCtx.createStereoPanner();
    const reverbSend = audioCtx.createGain();

    formantAGain.gain.value = side === 'Left' ? 0.68 : 0.42;
    formantBGain.gain.value = side === 'Left' ? 0.32 : 0.28;
    bodyGain.gain.value = side === 'Left' ? 0.24 : 0.36;
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.value = side === 'Left' ? 980 : 1180;
    bodyFilter.Q.value = 0.7;

    output.gain.value = 0;
    panner.pan.value = settings.pan;
    reverbSend.gain.value = getKnobValue(settings.spaceKnob) * 0.38;
    shaper.curve = makeDistortionCurve(getKnobValue(settings.edgeKnob));
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
        edgeKnob: settings.edgeKnob,
        spaceKnob: settings.spaceKnob,
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
        instrumentShell.classList.add('is-armed');
        dockOperationNotes();
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
        startButton.style.display = 'block';
        startButton.textContent = 'Activate field';
        instrumentShell.classList.remove('is-armed');
        operationNotes.classList.remove('is-collapsed');
        operationNotes.classList.remove('is-docking');
        serviceNotesButton.classList.remove('is-docking-target');
        canvasContainer.classList.remove('is-live');
        controls.classList.remove('is-live');
        drawStandby(`Audio or camera did not start: ${error.message || 'permission blocked'}`);
    }
}

function onResults(results) {
    resizeCanvas();

    handStates.Left.active = false;
    handStates.Right.active = false;

    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, i) => {
            const side = getPlayerSide(results.multiHandedness[i].label);
            if (!handStates[side]) return;

            updateHandState(side, landmarks);
        });
    }

    updateAudio();
    drawScope();
}

function getPlayerSide(mediaPipeSide) {
    return mediaPipeSide === 'Left' ? 'Right' : 'Left';
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
    masterGain.gain.setTargetAtTime(MASTER_GAIN, now, 0.035);

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

    const volume = state.active || state.age < 10 ? state.volume * (side === 'Left' ? 0.42 : 0.34) : 0;
    voice.oscillator.frequency.setTargetAtTime(state.frequency || settings.minHz, now, 0.055);
    voice.output.gain.setTargetAtTime(volume, now, 0.045);
    voice.panner.pan.setTargetAtTime(settings.pan, now, 0.08);
    voice.reverbSend.gain.setTargetAtTime(getKnobValue(settings.spaceKnob) * 0.42, now, 0.08);
    voice.shaper.curve = makeDistortionCurve(getKnobValue(settings.edgeKnob));

    settings.pitchDisplay.textContent = 'Hz';
    updateMeter(settings, state);
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
    drawWaveform();
    drawFieldBridge();
    drawVoice('Left');
    drawVoice('Right');
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
    const point = getFieldPoint(side);
    const displayX = point.x;
    const displayY = point.y;
    const level = clamp(state.volumeControl, 0, 1);
    const interference = getInterference();
    const glow = (state.active ? 0.62 : 0.32) + level * 0.42;
    const saturation = state.active ? 0.58 + level * 0.42 : 0.4;
    const fuzz = interference * level;
    const size = Math.max(14, width * (0.026 + level * 0.018 + interference * 0.014));

    canvasCtx.save();
    canvasCtx.globalAlpha = glow;
    canvasCtx.strokeStyle = withAlpha(settings.color, saturation);
    canvasCtx.fillStyle = withAlpha(settings.color, saturation);
    canvasCtx.lineWidth = Math.max(2.4, width * 0.004);
    canvasCtx.shadowColor = settings.color;
    canvasCtx.shadowBlur = width * (0.018 + level * 0.022);

    canvasCtx.beginPath();
    canvasCtx.arc(displayX, displayY, size, 0, Math.PI * 2);
    canvasCtx.stroke();

    canvasCtx.beginPath();
    canvasCtx.moveTo(displayX - size * 1.38, displayY);
    canvasCtx.lineTo(displayX + size * 1.38, displayY);
    canvasCtx.moveTo(displayX, displayY - size * 1.38);
    canvasCtx.lineTo(displayX, displayY + size * 1.38);
    canvasCtx.stroke();

    if (fuzz > 0.05) {
        canvasCtx.lineWidth = Math.max(1, width * 0.0015);
        for (let i = 0; i < 18; i += 1) {
            const angle = (Math.PI * 2 * i) / 18 + performance.now() * 0.0012;
            const inner = size * (1.12 + Math.sin(i * 2.1) * 0.18);
            const outer = size * (1.52 + fuzz * 1.35 + Math.cos(i * 1.7) * 0.22);
            canvasCtx.globalAlpha = fuzz * 0.72;
            canvasCtx.beginPath();
            canvasCtx.moveTo(displayX + Math.cos(angle) * inner, displayY + Math.sin(angle) * inner);
            canvasCtx.lineTo(displayX + Math.cos(angle) * outer, displayY + Math.sin(angle) * outer);
            canvasCtx.stroke();
        }
    }

    canvasCtx.restore();
}

function getFieldPoint(side) {
    const state = handStates[side];
    const { width, height } = canvasElement;
    const diagonal = clamp((state.pitchControl * 0.58) + ((1 - state.y) * 0.24) + (state.volumeControl * 0.18), 0, 1);
    const drift = Math.sin(performance.now() * 0.0011 + state.pitchControl * 5.5) * 0.028;
    const wobble = Math.sin(performance.now() * 0.0024 + state.pitchControl * 8) * 0.018 * (0.35 + state.volumeControl);
    const handPull = (state.x - 0.5) * 0.12;

    if (side === 'Left') {
        return {
            x: width * clamp(0.1 + diagonal * 0.56 + handPull + wobble, 0.08, 0.72),
            y: height * clamp(0.84 - diagonal * 0.64 + drift + wobble * 0.45, 0.14, 0.88),
        };
    }

    return {
        x: width * clamp(0.9 - diagonal * 0.56 + handPull - wobble, 0.28, 0.92),
        y: height * clamp(0.84 - diagonal * 0.64 - drift - wobble * 0.45, 0.14, 0.88),
    };
}

function drawFieldBridge() {
    const interference = getInterference();
    if (interference < 0.08) return;

    const leftPoint = getFieldPoint('Left');
    const rightPoint = getFieldPoint('Right');
    const { width } = canvasElement;
    const time = performance.now() * 0.014;

    canvasCtx.save();
    canvasCtx.lineWidth = Math.max(1, width * 0.0014);
    canvasCtx.shadowColor = '#f06a2f';
    canvasCtx.shadowBlur = width * 0.026 * interference;

    for (let strand = 0; strand < 9; strand += 1) {
        canvasCtx.beginPath();
        canvasCtx.strokeStyle = strand % 2 === 0
            ? `rgba(242, 209, 90, ${0.06 + interference * 0.22})`
            : `rgba(240, 106, 47, ${0.08 + interference * 0.26})`;

        for (let i = 0; i <= 14; i += 1) {
            const t = i / 14;
            const noise = Math.sin(t * Math.PI * (7 + strand) + time + strand) * width * (0.008 + strand * 0.0008) * interference;
            const spark = Math.sin((t + strand) * 31.7 + time) > 0.34 ? 1 : -1;
            const x = lerp(leftPoint.x, rightPoint.x, t);
            const y = lerp(leftPoint.y, rightPoint.y, t) + noise + spark * width * 0.006 * interference + (strand - 4) * width * 0.002 * interference;

            if (i === 0) {
                canvasCtx.moveTo(x, y);
            } else {
                canvasCtx.lineTo(x, y);
            }
        }
        canvasCtx.stroke();
    }

    canvasCtx.restore();
}

function getInterference() {
    const left = handStates.Left;
    const right = handStates.Right;
    if (!left.active || !right.active) return 0;

    const dx = left.x - right.x;
    const dy = left.y - right.y;
    const distanceBetweenHands = Math.sqrt(dx * dx + dy * dy);
    return clamp((0.48 - distanceBetweenHands) / 0.28, 0, 1) * Math.min(left.volumeControl, right.volumeControl);
}

function updateMeter(settings, state) {
    const range = settings.maxHz - settings.minHz;
    const normalized = clamp(((state.frequency || settings.minHz) - settings.minHz) / range, 0, 1);
    const displayPosition = state.active ? normalized : 0.5;
    const angle = -48 + displayPosition * 96;
    const glow = state.active ? 0.18 + clamp(state.volume, 0, 1) * 0.82 : 0.14;
    const outerField = state.active && state.pitchControl > 0.94;

    settings.meter.style.setProperty('--needle-angle', `${angle}deg`);
    settings.meter.style.setProperty('--meter-glow', glow.toFixed(3));
    settings.meter.classList.toggle('is-hot', outerField);
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
    const orange = handStates.Right;
    const jitterAmount = orange.volumeControl * radius * 0.026;
    const jitterCycles = 7 + orange.pitchControl * 18;
    const segments = 30;
    const perpendicular = angle + Math.PI / 2;

    canvasCtx.save();
    canvasCtx.strokeStyle = `rgba(240, 106, 47, ${0.28 + orange.volumeControl * 0.34})`;
    canvasCtx.lineWidth = Math.max(1, width * (0.0018 + orange.volumeControl * 0.0012));
    canvasCtx.beginPath();

    for (let i = 0; i <= segments; i += 1) {
        const progress = i / segments;
        const distanceFromCenter = radius * progress;
        const vibration = Math.sin(progress * Math.PI * 2 * jitterCycles + performance.now() * 0.018) * jitterAmount * progress;
        const x = cx + Math.cos(angle) * distanceFromCenter + Math.cos(perpendicular) * vibration;
        const y = cy + Math.sin(angle) * distanceFromCenter + Math.sin(perpendicular) * vibration;

        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
    }

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
    const drive = 1 + amount * 18;

    for (let i = 0; i < samples; i += 1) {
        const x = (i * 2) / samples - 1;
        curve[i] = Math.tanh(x * drive);
    }

    return curve;
}

function initKnobs() {
    Object.values(knobs).forEach((knob) => {
        if (!knob) return;

        setKnobValue(knob, getKnobValue(knob));

        knob.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            knob.setPointerCapture(event.pointerId);
            knob.dataset.dragY = String(event.clientY);
            knob.dataset.dragValue = String(getKnobValue(knob));
        });

        knob.addEventListener('pointermove', (event) => {
            if (!knob.hasPointerCapture(event.pointerId)) return;

            const startY = Number(knob.dataset.dragY);
            const startValue = Number(knob.dataset.dragValue);
            const delta = (startY - event.clientY) / 150;
            setKnobValue(knob, startValue + delta);
        });

        knob.addEventListener('keydown', (event) => {
            const step = event.shiftKey ? 0.1 : 0.03;
            if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
                event.preventDefault();
                setKnobValue(knob, getKnobValue(knob) + step);
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
                event.preventDefault();
                setKnobValue(knob, getKnobValue(knob) - step);
            }
            if (event.key === 'Home') {
                event.preventDefault();
                setKnobValue(knob, 0);
            }
            if (event.key === 'End') {
                event.preventDefault();
                setKnobValue(knob, 1);
            }
        });
    });
}

function getKnobValue(knob) {
    return clamp(Number(knob?.dataset.value || 0), 0, 1);
}

function setKnobValue(knob, value) {
    const normalized = clamp(value, 0, 1);
    const angle = -135 + normalized * 270;

    knob.dataset.value = normalized.toFixed(3);
    knob.style.setProperty('--knob-angle', `${angle}deg`);
    knob.setAttribute('aria-valuenow', String(Math.round(normalized * 100)));
}

function openServiceNotes() {
    serviceNotesModal.hidden = false;
    closeServiceNotes.focus();
}

function closeServicePanel() {
    serviceNotesModal.hidden = true;
    serviceNotesButton.focus();
}

function distance(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function withAlpha(hex, alpha) {
    const cleanHex = hex.replace('#', '');
    const red = parseInt(cleanHex.slice(0, 2), 16);
    const green = parseInt(cleanHex.slice(2, 4), 16);
    const blue = parseInt(cleanHex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

initKnobs();
updateMeter(VOICE_SETTINGS.Left, handStates.Left);
updateMeter(VOICE_SETTINGS.Right, handStates.Right);

startButton.addEventListener('click', startTheremin);
serviceNotesButton.addEventListener('click', openServiceNotes);
closeServiceNotes.addEventListener('click', closeServicePanel);
serviceNotesModal.addEventListener('click', (event) => {
    if (event.target === serviceNotesModal) {
        closeServicePanel();
    }
});
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !serviceNotesModal.hidden) {
        closeServicePanel();
    }
});
window.addEventListener('resize', () => {
    if (camera) {
        drawScope();
    } else {
        drawStandby();
    }
});
drawStandby();
