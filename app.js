/* app.js - Webapp logikája javításokkal */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Általános UI elemek
    const cameraWrapper = document.getElementById('camera-wrapper');
    const cameraPreview = document.getElementById('camera-preview');
    const finalCanvas = document.getElementById('final-canvas');
    const captureBtn = document.getElementById('capture-btn');
    const dateBtn = document.getElementById('date-btn');
    const evBtn = document.getElementById('ev-btn');
    const filterBtn = document.getElementById('filter-btn');
    const filtersContainer = document.getElementById('filters-container');
    const filtersList = document.getElementById('filters-list');
    const evControls = document.getElementById('ev-controls');
    const evSlider = document.getElementById('ev-slider');

    let isDateActive = false;
    let currentFilterId = 'normal';
    let localStream = null;
    let originalPhotoBlob = null; // A captured photo raw data
    let frameMaskCanvas = null; // Pre-processed frame with transparent hole

    // 2. Eszközök és MediaStream inicializálása
    async function initializeCamera() {
        try {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
            localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            cameraPreview.srcObject = localStream;
            await cameraPreview.play();
            resetView(); // Capture button view, etc.
        } catch (error) {
            console.error("Camera access failed:", error);
            alert("Sajnos nem sikerült hozzáférni a kamerához.");
        }
    }

    // Bug 2 Javítás: JPG keret belső részének átlátszóvá tétele offscreen canvason
    async function createFrameMask() {
        return new Promise((resolve) => {
            const frameImg = new Image();
            frameImg.src = 'antik_keret_web.jpg';
            frameImg.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = frameImg.naturalWidth;
                canvas.height = frameImg.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(frameImg, 0, 0);

                // Color-keying: a sötét belső rész eltávolítása (átlátszóvá tétele)
                // A JPG nem támogatja az átlátszóságot, ezért ezt dinamikusan kell megoldani.
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                const keyColorThreshold = 30; // Threshold a sötét színek kulcsolásához

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];

                    // Ha a pixel közel van a feketéhez, átlátszóvá tesszük (Alpha = 0)
                    if (r < keyColorThreshold && g < keyColorThreshold && b < keyColorThreshold) {
                        data[i + 3] = 0;
                    }
                }
                ctx.putImageData(imageData, 0, 0); // "Lyukas" keret létrehozva
                frameMaskCanvas = canvas;
                resolve();
            };
        });
    }

    // 3. Kép készítése
    captureBtn.addEventListener('click', async () => {
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = cameraPreview.videoWidth;
        offscreenCanvas.height = cameraPreview.videoHeight;
        const ctx = offscreenCanvas.getContext('2d');
        ctx.drawImage(cameraPreview, 0, 0);
        
        originalPhotoBlob = await new Promise(resolve => offscreenCanvas.toBlob(resolve, 'image/jpeg', 0.9));
        
        applyFiltersAndDraw(); // Render current filter
        showFinalCanvas();
    });

    // Bug 1 Javítás: EV Slider megnyitásakor a középérték beállítása
    evBtn.addEventListener('click', () => {
        evControls.classList.toggle('active');
        filtersContainer.classList.remove('active');
        if (evControls.classList.contains('active')) {
            evSlider.value = 0; // Explicitly set slider to center (0) when opened
            evSlider.dispatchEvent(new Event('input')); // Trigger update (hypothetically)
        }
    });

    // 4. Szűrők alkalmazása és kompozíció (Antik keret fixszel és dátummal)
    async function applyFiltersAndDraw() {
        if (!originalPhotoBlob) return;

        // Create a working canvas to combine photo + filters + frame
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        const finalCtx = finalCanvas.getContext('2d');

        // Load the captured photo onto working canvas
        const photoImg = new Image();
        photoImg.src = URL.createObjectURL(originalPhotoBlob);
        await photoImg.decode();
        
        tempCanvas.width = photoImg.width;
        tempCanvas.height = photoImg.height;
        tempCtx.drawImage(photoImg, 0, 0);
        
        // Apply EV adjustment (simulated, needs actual shader logic for full effect)
        const evValue = parseFloat(evSlider.value);
        // Simple visual brightness shift
        tempCtx.globalCompositeOperation = 'source-over';
        tempCtx.fillStyle = evValue > 0 ? `rgba(255,255,255,${evValue/5})` : `rgba(0,0,0,${-evValue/5})`;
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.globalCompositeOperation = 'source-over'; // Reset

        // --- Filter logic ---
        // FinalCanvas size and aspect ratio should usually match the Frame for 'antik'
        
        if (currentFilterId === 'antik') {
            // Bug 2 & 3 Kompozíció Javítás
            
            // 1. Set final canvas size to frame size (assumes portrait or square provided)
            finalCanvas.width = frameMaskCanvas.width;
            finalCanvas.height = frameMaskCanvas.height;
            
            // 2. Draw photo scaled to cover final canvas (it will show through the hole)
            finalCtx.globalCompositeOperation = 'source-over';
            const photoAspect = photoImg.width / photoImg.height;
            const frameAspect = finalCanvas.width / finalCanvas.height;
            let sx, sy, sw, sh;
            if (photoAspect > frameAspect) { // Wide photo, crop sides
                sh = photoImg.height;
                sw = sh * frameAspect;
                sy = 0;
                sx = (photoImg.width - sw) / 2;
            } else { // Tall photo, crop top/bottom
                sw = photoImg.width;
                sh = sw / frameAspect;
                sx = 0;
                sy = (photoImg.height - sh) / 2;
            }
            finalCtx.drawImage(photoImg, sx, sy, sw, sh, 0, 0, finalCanvas.width, finalCanvas.height);

            // 3. Draw pre-processed frame with transparent hole over photo
            finalCtx.drawImage(frameMaskCanvas, 0, 0);

            // Bug 3 Javítás: Dátum hozzáadása a keretre/fotóra
            if (isDateActive) {
                const today = new Date();
                const dateString = `${today.getFullYear()}. ${String(today.getMonth() + 1).padStart(2, '0')}. ${String(today.getDate()).padStart(2, '0')}.`;
                
                // Font stílus: Antik-jellegű serif font. 'serif' generikus serif.
                finalCtx.font = '70px "Old Standard TT", Garamond, serif'; // Antique font choice
                finalCtx.fillStyle = '#f5f5dc'; // Drapp (Beige/Tan) color
                finalCtx.textAlign = 'right';
                finalCtx.textBaseline = 'bottom';
                
                // Pozíció: Jobb alsó rész, a keret belső pereméhez igazítva, de fölötte.
                // Proporcionális margók a teljes felbontású canvason.
                const marginX = finalCanvas.width * 0.05; // 5% a széltől
                const marginY = finalCanvas.height * 0.07; // 7% az aljától, hogy a keret ne takarja
                finalCtx.fillText(dateString, finalCanvas.width - marginX, finalCanvas.height - marginY);
            }

        } else if (currentFilterId === 'bw') {
            finalCanvas.width = photoImg.width;
            finalCanvas.height = photoImg.height;
            finalCtx.filter = 'grayscale(100%)';
            finalCtx.drawImage(tempCanvas, 0, 0);
            finalCtx.filter = 'none'; // Reset
        } else if (currentFilterId === 'sepia') {
            finalCanvas.width = photoImg.width;
            finalCanvas.height = photoImg.height;
            finalCtx.filter = 'sepia(100%)';
            finalCtx.drawImage(tempCanvas, 0, 0);
            finalCtx.filter = 'none'; // Reset
        } else { // normal
            finalCanvas.width = photoImg.width;
            finalCanvas.height = photoImg.height;
            finalCtx.drawImage(tempCanvas, 0, 0);
        }
        
        URL.revokeObjectURL(photoImg.src); // Cleanup
    }

    // UI helper functions
    function resetView() {
        cameraPreview.style.display = 'block';
        finalCanvas.style.display = 'none';
        captureBtn.style.display = 'flex';
        evControls.classList.remove('active');
        filtersContainer.classList.remove('active');
        originalPhotoBlob = null;
    }

    function showFinalCanvas() {
        cameraPreview.style.display = 'none';
        finalCanvas.style.display = 'block';
        captureBtn.style.display = 'none';
    }

    // Filter selection logic
    filterBtn.addEventListener('click', () => {
        filtersContainer.classList.toggle('active');
        evControls.classList.remove('active');
    });

    filtersList.addEventListener('click', (e) => {
        const item = e.target.closest('.filter-item');
        if (item) {
            document.querySelectorAll('.filter-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentFilterId = item.id.replace('filter-', '');
            if (originalPhotoBlob) {
                applyFiltersAndDraw();
            }
        }
    });

    dateBtn.addEventListener('click', () => {
        isDateActive = !isDateActive;
        dateBtn.innerHTML = isDateActive ? '<img src="icon-180.png" style="opacity: 1;">' : '<img src="icon-180.png" style="opacity: 0.5;">'; // Vizualis feedback ikonnal
        if (originalPhotoBlob && currentFilterId === 'antik') {
            applyFiltersAndDraw(); // Re-render with date
        }
    });

    // Start
    (async () => {
        await createFrameMask(); // Pre-process JPG frame
        await initializeCamera();
    })();

});