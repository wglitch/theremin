// =================================================================
// HELA DIN THEREMIN.JS - KORREKT VERSION
// =================================================================

// HÄMTA DEBUG-ELEMENTEN EN GÅNG HÖGST UPP I FILEN
const debugInfo = document.getElementById('debugInfo'); 
const debugZ = document.getElementById('debugZ');
const debugPitch = document.getElementById('debugPitch');

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
    
    // Visa canvas, kontroller OCH den nya debug-rutan
    canvasContainer.style.display = 'block';
    controls.style.display = 'block';
    debugInfo.style.display = 'block'; // Denna rad gör debug-rutan synlig
 
    const camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({ image: videoElement });
        },
        width: 1280,
        height: 720
    });
    camera.start();
}}

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
    const NEAR_Z = -0.05; // Värdet när handen är NÄRA för LÄGSTA tonen
    const FAR_Z = -0.9;   // Värdet när handen är LÅNGT BORT för HÖGSTA tonen

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
                
                // === SLUTGILTIG, KORREKT LOGIK FÖR TONHÖJD ===

                // Steg 1: Normalisera avståndet.
                // Vi omvandlar Z-värdet till en procentsats (0.0 till 1.0) mellan NEAR_Z och FAR_Z.
                // Detta är den matematiskt korrekta formeln för att göra detta.
                let pitchControl = (zValue - NEAR_Z) / (FAR_Z - NEAR_Z);
                
                // Steg 2: Säkerställ att värdet håller sig inom 0.0 och 1.0.
                pitchControl = Math.max(0, Math.min(1, pitchControl));

                // Resultat:
                // Om zValue är -0.05 (NÄRA), blir pitchControl 0.0 -> LÅG TON.
                // Om zValue är -0.9 (LÅNGT BORT), blir pitchControl 1.0 -> HÖG TON.

                const freq = 40 + pitchControl * 960; // Mappa till 40Hz - 1000Hz

                // Radiell volym
                const distanceFromCenter = Math.sqrt(Math.pow(fingerTip.x - 0.5, 2) + Math.pow(fingerTip.y - 0.5, 2));
                const vol = Math.max(0, 1 - (distanceFromCenter / 0.707));

                // Uppdatera ljudet
                oscillators[handIndex].frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.01);
                gains[handIndex].gain.setTargetAtTime(vol, audioCtx.currentTime, 0.01);

                // Uppdatera UI (med rätt element från din HTML)
                document.getElementById(`freq${handIndex + 1}`).textContent = `${Math.round(freq)} Hz`;
                document.getElementById(`vol${handIndex + 1}`).textContent = `${Math.round(vol * 100)}%`;

                // Uppdatera debug-info
                debugZ.textContent = zValue.toFixed(3);
                debugPitch.textContent = pitchControl.toFixed(3);
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