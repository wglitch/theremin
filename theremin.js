
// STEG 1: Hämta referenser till HTML-element
const startButton = document.getElementById('startButton');
const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

let audioCtx;
let gains = [];
 
// STEG 2: INITIERA MEDIAPIPE HANDS (INKLISTRAD KOD)
const hands = new Hands({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});
hands.onResults(onResults); // Viktigt att denna rad är med!
 
// STEG 3: KOPPLA STARTKNAPPEN OCH DEFINIERA STARTSEKVENSEN
startButton.addEventListener('click', startTheremin);
 
function startTheremin() {
  initAudio();
  console.log('Theremin startad!');
 
  // Hämta canvas-containern
  const canvasContainer = document.getElementById('canvasContainer');
  const controls = document.getElementById('controls');
 
  // ---- DETTA ÄR DE VIKTIGA RADERNA ----
  // Dölj startknappen
  startButton.style.display = 'none';
  // Visa canvas och kontroller
  canvasContainer.style.display = 'block';
  controls.style.display = 'block';
  // ------------------------------------
 
  const camera = new Camera(videoElement, {
    onFrame: async () => {
      await hands.send({ image: videoElement });
    },
    width: 1280,
    height: 720
  });
  camera.start();
}
  // -----------------------------

  // Göm knappen så man inte kan klicka igen
  startButton.style.display = 'none';

  // STEG 1: ANROPA DIN BEFINTLIGA LJUD-FUNKTION
  // Denna sätter upp allt ljud, men det är fortfarande pausat.
  initAudio(); 

  // STEG 2: STARTA KAMERAN
  navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
    .then((stream) => {
      // Om kameran lyckas...
      videoElement.srcObject = stream;

      // STEG 3: STARTA MEDIAPIPE-PROCESSEN
      // Detta kopplar ihop kameran med hand-igenkänningen
      const camera = new Camera(videoElement, {
        onFrame: async () => {
          await hands.send({ image: videoElement });
        },
        width: 1280,
        height: 720
      });
      camera.start();

      console.log("Theremin startad!");

    }).catch((err) => {
      // Om kameran misslyckas...
      console.error("Kunde inte starta kameran!", err);
      alert("Kameran kunde inte startas. Vänligen ge tillåtelse och ladda om sidan.");
      // Visa knappen igen så användaren kan försöka på nytt
      startButton.style.display = 'block';
    });
}

// === DIN BEFINTLIGA KOD FORTSÄTTER HÄR ===
// Låt all din andra kod vara kvar precis som den är, inklusive:
// const hands = new Hands({...});
// hands.onResults(onResults);
// function onResults(results) { ... }
// function initAudio() { ... }  <-- LÅT DENNA VARA KVAR!
// ...och alla andra hjälpfunktioner.


// Utility function
function map(value, inMin, inMax, outMin, outMax) {
  return (value - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

// Audio setup - SEPARATE EFFECTS PER HAND
let audioContext;
let oscillator1, oscillator2;
let gainNode1, gainNode2;
let masterGain;

// HAND 1 EFFECTS
let convolver1, delay1, delayFeedback1, delayGain1, distortion1;
let dry1, wet1, reverbGain1, delayMix1, distortionGain1;

// HAND 2 EFFECTS
let convolver2, delay2, delayFeedback2, delayGain2, distortion2;
let dry2, wet2, reverbGain2, delayMix2, distortionGain2;

let isPlaying = false;

function initAudio() {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();

 // === NYCKELN TILL LÖSNINGEN ===
  // Se till att ljudkontexten är aktiv.
  // Den måste startas av en användarinteraktion (t.ex. ett klick).
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  // =============================
  
  // Master gain
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0.7;
  masterGain.connect(audioContext.destination);
  
  // ===== HAND 1 SETUP =====
  oscillator1 = audioContext.createOscillator();
  gainNode1 = audioContext.createGain();
  oscillator1.type = 'sine';
  oscillator1.frequency.value = 440;
  gainNode1.gain.value = 0;
  
  // Hand 1 effects
  dry1 = audioContext.createGain();
  wet1 = audioContext.createGain();
  dry1.gain.value = 1.0;
  wet1.gain.value = 0.0;
  
  convolver1 = audioContext.createConvolver();
  convolver1.buffer = createReverbImpulse(2, 2);
  reverbGain1 = audioContext.createGain();
  reverbGain1.gain.value = 0.3;
  
  delay1 = audioContext.createDelay(5.0);
  delay1.delayTime.value = 0.3;
  delayFeedback1 = audioContext.createGain();
  delayFeedback1.gain.value = 0.0;
  delayGain1 = audioContext.createGain();
  delayGain1.gain.value = 0.0;
  delayMix1 = audioContext.createGain();
  delayMix1.gain.value = 0.0;
  
  delay1.connect(delayFeedback1);
  delayFeedback1.connect(delay1);
  delay1.connect(delayGain1);
  delayGain1.connect(delayMix1);
  
  distortion1 = audioContext.createWaveShaper();
  distortion1.curve = makeDistortionCurve(0);
  distortion1.oversample = '4x';
  distortionGain1 = audioContext.createGain();
  distortionGain1.gain.value = 1.0;
  
  // Hand 1 routing
  oscillator1.connect(gainNode1);
  gainNode1.connect(distortion1);
  distortion1.connect(distortionGain1);
  distortionGain1.connect(dry1);
  distortionGain1.connect(convolver1);
  distortionGain1.connect(delay1);
  convolver1.connect(reverbGain1);
  reverbGain1.connect(wet1);
  delayMix1.connect(wet1);
  dry1.connect(masterGain);
  wet1.connect(masterGain);
  
  oscillator1.start();
  
  // ===== HAND 2 SETUP =====
  oscillator2 = audioContext.createOscillator();
  gainNode2 = audioContext.createGain();
  oscillator2.type = 'triangle';
  oscillator2.frequency.value = 440;
  gainNode2.gain.value = 0;
  
  // Hand 2 effects
  dry2 = audioContext.createGain();
  wet2 = audioContext.createGain();
  dry2.gain.value = 1.0;
  wet2.gain.value = 0.0;
  
  convolver2 = audioContext.createConvolver();
  convolver2.buffer = createReverbImpulse(2, 2);
  reverbGain2 = audioContext.createGain();
  reverbGain2.gain.value = 0.5;
  
  delay2 = audioContext.createDelay(5.0);
  delay2.delayTime.value = 0.4;
  delayFeedback2 = audioContext.createGain();
  delayFeedback2.gain.value = 0.4;
  delayGain2 = audioContext.createGain();
  delayGain2.gain.value = 0.4;
  delayMix2 = audioContext.createGain();
  delayMix2.gain.value = 0.4;
  
  delay2.connect(delayFeedback2);
  delayFeedback2.connect(delay2);
  delay2.connect(delayGain2);
  delayGain2.connect(delayMix2);
  
  distortion2 = audioContext.createWaveShaper();
  distortion2.curve = makeDistortionCurve(0);
  distortion2.oversample = '4x';
  distortionGain2 = audioContext.createGain();
  distortionGain2.gain.value = 1.0;
  
  // Hand 2 routing
  oscillator2.connect(gainNode2);
  gainNode2.connect(distortion2);
  distortion2.connect(distortionGain2);
  distortionGain2.connect(dry2);
  distortionGain2.connect(convolver2);
  distortionGain2.connect(delay2);
  convolver2.connect(reverbGain2);
  reverbGain2.connect(wet2);
  delayMix2.connect(wet2);
  dry2.connect(masterGain);
  wet2.connect(masterGain);
  
  oscillator2.start();
  
  isPlaying = true;
  setupControlListeners();
  console.log('Audio initialized with separate effects per hand');
}

// Create reverb impulse response
function createReverbImpulse(duration, decay) {
  const sampleRate = audioContext.sampleRate;
  const length = sampleRate * duration;
  const impulse = audioContext.createBuffer(2, length, sampleRate);
  const impulseL = impulse.getChannelData(0);
  const impulseR = impulse.getChannelData(1);
  
  for (let i = 0; i < length; i++) {
    impulseL[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    impulseR[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return impulse;
}

// Create distortion curve
function makeDistortionCurve(amount) {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// Setup control listeners
function setupControlListeners() {
  // Wave type controls
  document.getElementById('waveType1').addEventListener('change', (e) => {
    oscillator1.type = e.target.value;
  });
  
  document.getElementById('waveType2').addEventListener('change', (e) => {
    oscillator2.type = e.target.value;
  });
  
  // Hand 1 effects
  document.getElementById('reverb1').addEventListener('input', (e) => {
    const value = e.target.value / 100;
    reverbGain1.gain.value = value;
    wet1.gain.value = value * 0.5;
    document.getElementById('reverb1Value').textContent = e.target.value + '%';
  });
  
  document.getElementById('delay1').addEventListener('input', (e) => {
    const value = e.target.value / 100;
    delayMix1.gain.value = value;
    delayFeedback1.gain.value = value * 0.6;
    document.getElementById('delay1Value').textContent = e.target.value + '%';
  });
  
  document.getElementById('distortion1').addEventListener('input', (e) => {
    const value = e.target.value / 100;
    distortion1.curve = makeDistortionCurve(value * 100);
    document.getElementById('distortion1Value').textContent = e.target.value + '%';
  });
  
  // Hand 2 effects
  document.getElementById('reverb2').addEventListener('input', (e) => {
    const value = e.target.value / 100;
    reverbGain2.gain.value = value;
    wet2.gain.value = value * 0.5;
    document.getElementById('reverb2Value').textContent = e.target.value + '%';
  });
  
  document.getElementById('delay2').addEventListener('input', (e) => {
    const value = e.target.value / 100;
    delayMix2.gain.value = value;
    delayFeedback2.gain.value = value * 0.6;
    document.getElementById('delay2Value').textContent = e.target.value + '%';
  });
  
  document.getElementById('distortion2').addEventListener('input', (e) => {
    const value = e.target.value / 100;
    distortion2.curve = makeDistortionCurve(value * 100);
    document.getElementById('distortion2Value').textContent = e.target.value + '%';
  });
  
  // Master volume
  document.getElementById('masterVolume').addEventListener('input', (e) => {
    masterGain.gain.value = e.target.value / 100;
    document.getElementById('masterValue').textContent = e.target.value + '%';
  });
}

function updateTone(handIndex, pitch, volume) {
  if (!isPlaying || !audioContext) return;
  
  const now = audioContext.currentTime;
  
  if (handIndex === 0) {
    oscillator1.frequency.linearRampToValueAtTime(pitch, now + 0.05);
    gainNode1.gain.linearRampToValueAtTime(volume * 0.3, now + 0.05);
    
    document.getElementById('pitch1').textContent = `Hand 1: ${Math.round(pitch)} Hz`;
    document.getElementById('volume1').textContent = `Vol: ${Math.round(volume * 100)}%`;
  } else {
    oscillator2.frequency.linearRampToValueAtTime(pitch, now + 0.05);
    gainNode2.gain.linearRampToValueAtTime(volume * 0.3, now + 0.05);
    
    document.getElementById('pitch2').textContent = `Hand 2: ${Math.round(pitch)} Hz`;
    document.getElementById('volume2').textContent = `Vol: ${Math.round(volume * 100)}%`;
  }
}

function silenceOscillator(handIndex) {
  if (!isPlaying || !audioContext) return;
  
  const now = audioContext.currentTime;
  
  if (handIndex === 0) {
    gainNode1.gain.linearRampToValueAtTime(0, now + 0.1);
    document.getElementById('pitch1').textContent = `Hand 1: --`;
    document.getElementById('volume1').textContent = `Vol: --%`;
  } else {
    gainNode2.gain.linearRampToValueAtTime(0, now + 0.1);
    document.getElementById('pitch2').textContent = `Hand 2: --`;
    document.getElementById('volume2').textContent = `Vol: --%`;
  }
}


// MediaPipe Hands setup
let camera;

function initCamera() {
  console.log('Initializing camera...');
  
  if (typeof Hands === 'undefined') {
    console.error('MediaPipe Hands not loaded!');
    alert('Error: MediaPipe library failed to load. Check your internet connection.');
    return;
  }
  
  
  
  console.log('Requesting camera access...');
  
  navigator.mediaDevices.getUserMedia({ 
    video: { 
      width: 640, 
      height: 480,
      facingMode: 'user'
    } 
  })
  .then(stream => {
    console.log('Camera access granted');
    videoElement.srcObject = stream;
    videoElement.play();
    
    async function sendFrame() {
      if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
        await hands.send({image: videoElement});
      }
      requestAnimationFrame(sendFrame);
    }
    sendFrame();
  })
  .catch(err => {
    console.error('Camera error:', err);
    alert('Camera access denied or not available: ' + err.message);
  });
}


function onResults(results) {
  // Spara canvas-inställningar
  canvasCtx.save();
  
  // Rensa canvasen inför nästa bildruta
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  // ---- LÄGG TILL DENNA VIKTIGA RAD ----
  // Rita den aktuella kamerabilden på canvasen
  canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
  // ------------------------------------

  // Om händer upptäcks, rita dem ovanpå bilden
  if (results.multiHandLandmarks && results.multiHandedness) {
    for (let index = 0; index < results.multiHandLandmarks.length; index++) {
      const classification = results.multiHandedness[index];
      const isRightHand = classification.label === 'Right';
      const landmarks = results.multiHandLandmarks[index];
      
      // Rita anslutningar (skelettet)
      drawConnectors(
        canvasCtx, landmarks, HAND_CONNECTIONS,
        {color: isRightHand ? '#00FF00' : '#FF0000'});
        
      // Rita landmärken (prickarna)
      drawLandmarks(canvasCtx, landmarks, {
        color: isRightHand ? '#00FF00' : '#FF0000',
        fillColor: isRightHand ? '#FF0000' : '#00FF00',
        radius: (data) => {
          return lerp(data.from.z, -0.15, .1, 10, 1);
        }
      });
    }
  }

  // Återställ canvas-inställningar
  canvasCtx.restore();

  // ----- Här börjar din befintliga ljudlogik -----
  // (Denna del ska du redan ha)
  const detectedHands = [false, false]; // [Hand 1, Hand 2]
  if (results.multiHandLandmarks && results.multiHandedness) {
    results.multiHandLandmarks.forEach((landmarks, i) => {
      const handIndex = results.multiHandedness[i].label === 'Left' ? 0 : 1;
      detectedHands[handIndex] = true;
      
      const wrist = landmarks[0];
      const thumbTip = landmarks[4];
      
      let pitch = 1 - Math.min(1, Math.max(0, wrist.y));
      let volume = 1 - Math.min(1, Math.max(0, wrist.x));
      let depth = Math.abs(thumbTip.z - wrist.z);
      
      updateTheremin(handIndex, pitch, volume, depth);
    });
  }

  detectedHands.forEach((isDetected, index) => {
    if (!isDetected && gains[index]) {
      gains[index].gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
      updateInfoDisplay(index, 0, 0, 0, false);
    }
  });
}
  // Stäng av ljudet för händer som inte detekteras
  detectedHands.forEach((isDetected, index) => {
    if (!isDetected && gains[index]) {
      gains[index].gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
    }
  });

  canvasCtx.restore();
}